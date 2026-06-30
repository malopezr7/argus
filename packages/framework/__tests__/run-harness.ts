/**
 * Test harness: minimal in-process Argus runner for Vitest unit tests.
 *
 * Because `index.ts` captures `print` at module-eval time (before any user
 * code), we cannot safely import it in Node/Vitest (print is undefined there).
 * This harness directly exercises `jest-api.ts` + `hooks.ts` instead.
 *
 * It reimplements just enough of the runner logic to produce totals/status
 * values, letting the unit tests assert on observable outcomes without needing
 * Hermes. The real integration path (full pipeline + Hermes) is covered by
 * `examples/jest-api.test.ts` run via `pnpm argus`.
 */

import {
  type IdempotentGuard,
  runAfterAll,
  runAfterEachChain,
  runBeforeAll,
  runBeforeEachChain,
} from '../src/hooks.js';
import {
  computeHasOnly,
  effectivelySkipped,
  getRootChildren,
  included,
  type PendingSuite,
  type PendingTest,
  resetRegistry,
  subtreeHasOnly,
} from '../src/jest-api.js';
import { resetAssertions, verifyAssertions } from '../src/matchers.js';

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  failureMessage?: string;
}

export interface SuiteResult {
  name: string;
  suites: SuiteResult[];
  tests: TestResult[];
}

export interface Totals {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  total: number;
}

export interface RunResult {
  suites: SuiteResult[];
  totals: Totals;
}

/** Flatten all tests from all suites recursively. */
export function flattenTests(suites: SuiteResult[]): TestResult[] {
  const out: TestResult[] = [];
  function walk(s: SuiteResult): void {
    for (const t of s.tests) out.push(t);
    for (const c of s.suites) walk(c);
  }
  for (const s of suites) walk(s);
  return out;
}

async function runTest(
  t: PendingTest,
  totals: Totals,
  chain: PendingSuite[],
  beforeAllError?: Error,
): Promise<TestResult> {
  totals.total++;

  if (t.mode === 'todo') {
    totals.todo++;
    return { name: t.name, status: 'todo' };
  }
  if (t.mode === 'skip') {
    totals.skipped++;
    return { name: t.name, status: 'skipped' };
  }
  if (beforeAllError !== undefined) {
    totals.failed++;
    return { name: t.name, status: 'failed', failureMessage: beforeAllError.message };
  }

  resetAssertions();
  const beErr = await runBeforeEachChain(chain);
  if (beErr !== undefined) {
    await runAfterEachChain(chain);
    totals.failed++;
    return { name: t.name, status: 'failed', failureMessage: beErr.message };
  }

  let testErr: Error | undefined;
  try {
    await t.fn?.();
  } catch (e) {
    testErr = e instanceof Error ? e : new Error(String(e));
  }

  const aeErr = await runAfterEachChain(chain);
  const assertErr = verifyAssertions();

  if (testErr !== undefined) {
    totals.failed++;
    const extra = aeErr !== undefined ? ` (afterEach: ${aeErr.message})` : '';
    return { name: t.name, status: 'failed', failureMessage: testErr.message + extra };
  }
  if (aeErr !== undefined) {
    totals.failed++;
    return { name: t.name, status: 'failed', failureMessage: aeErr.message };
  }
  if (assertErr !== undefined) {
    totals.failed++;
    return { name: t.name, status: 'failed', failureMessage: assertErr.message };
  }

  totals.passed++;
  return { name: t.name, status: 'passed' };
}

/**
 * Check whether a suite has any included descendant (test or nested test).
 * Used to decide whether to run beforeAll/afterAll.
 */
function suiteHasIncludedDescendant(
  suite: PendingSuite,
  selfSkipped: boolean,
  ancestorsHaveOnly: boolean,
  hasOnly: boolean,
): boolean {
  for (let i = 0; i < suite.children.length; i++) {
    const child = suite.children[i];
    if (child.kind === 'test') {
      // todo placeholders never execute → not a hook-triggering descendant (REQ-14).
      if (child.mode !== 'todo' && included(child, selfSkipped, ancestorsHaveOnly, hasOnly)) {
        return true;
      }
    } else {
      const childSkipped = effectivelySkipped(child, selfSkipped);
      const childIncluded = included(child, selfSkipped, ancestorsHaveOnly, hasOnly);
      if (
        childIncluded &&
        suiteHasIncludedDescendant(
          child,
          childSkipped,
          ancestorsHaveOnly || suite.mode === 'only',
          hasOnly,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

async function runSuite(
  suite: PendingSuite,
  totals: Totals,
  chain: PendingSuite[],
  hasOnly: boolean,
  ancestorsHaveOnly: boolean,
  ancestorSkipped: boolean,
  inheritedBeforeAllError?: Error,
): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const suites: SuiteResult[] = [];

  const selfSkipped = effectivelySkipped(suite, ancestorSkipped);
  const selfHasOnly = suite.mode === 'only';
  // D2: select-all only when this .only block has no deeper .only re-narrowing
  const selfSelectsAll = selfHasOnly && !subtreeHasOnly(suite, selfSkipped);
  const childAncestorsHaveOnly = ancestorsHaveOnly || selfSelectsAll;

  const nextChain: PendingSuite[] = [];
  for (let k = 0; k < chain.length; k++) nextChain[k] = chain[k];
  nextChain[nextChain.length] = suite;

  const guard: IdempotentGuard = { ran: false };
  let suiteBeforeAllError: Error | undefined = inheritedBeforeAllError;

  // Determine if this suite should run beforeAll/afterAll at all
  const hasDescendants = suiteHasIncludedDescendant(
    suite,
    selfSkipped,
    childAncestorsHaveOnly,
    hasOnly,
  );

  for (let i = 0; i < suite.children.length; i++) {
    const child = suite.children[i];
    const childIncluded = included(child, selfSkipped, childAncestorsHaveOnly, hasOnly);

    if (child.kind === 'test') {
      if (!childIncluded) {
        totals.total++;
        totals.skipped++;
        tests[tests.length] = { name: child.name, status: 'skipped' };
        continue;
      }
      // Run beforeAll once before the first EXECUTABLE test. todo placeholders
      // are reported but MUST NOT trigger lifecycle hooks (REQ-14).
      if (child.mode !== 'todo' && suiteBeforeAllError === undefined) {
        const baErr = await runBeforeAll(suite, guard);
        if (baErr !== undefined) suiteBeforeAllError = baErr;
      }
      tests[tests.length] = await runTest(child, totals, nextChain, suiteBeforeAllError);
    } else {
      // child suite — run beforeAll before descending only if the child subtree
      // has an executable (non-todo) descendant (REQ-14).
      const childHasExecutable = suiteHasIncludedDescendant(
        child,
        effectivelySkipped(child, selfSkipped),
        childAncestorsHaveOnly,
        hasOnly,
      );
      if (childIncluded && childHasExecutable && suiteBeforeAllError === undefined) {
        const baErr = await runBeforeAll(suite, guard);
        if (baErr !== undefined) suiteBeforeAllError = baErr;
      }
      const sub = await runSuite(
        child,
        totals,
        nextChain,
        hasOnly,
        childAncestorsHaveOnly,
        selfSkipped,
        suiteBeforeAllError,
      );
      suites[suites.length] = sub;
    }
  }

  // Run afterAll after all children drain (if we have/had included descendants)
  if (hasDescendants || inheritedBeforeAllError !== undefined) {
    const aaErr = await runAfterAll(suite);
    if (aaErr !== undefined) {
      totals.total++;
      totals.failed++;
      tests[tests.length] = {
        name: 'afterAll hook',
        status: 'failed',
        failureMessage: aaErr.message,
      };
    }
  }

  return { name: suite.name, suites, tests };
}

export async function runWith(setup: () => void): Promise<RunResult> {
  resetRegistry();
  setup();

  const rootNodes = getRootChildren();
  const hasOnly = computeHasOnly(rootNodes, false);
  const totals: Totals = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  const resultSuites: SuiteResult[] = [];

  for (let i = 0; i < rootNodes.length; i++) {
    const node = rootNodes[i];
    if (node.kind === 'suite') {
      resultSuites[resultSuites.length] = await runSuite(node, totals, [], hasOnly, false, false);
    }
  }

  resetRegistry();
  return { suites: resultSuites, totals };
}

// Re-export Argus APIs
export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  test,
} from '../src/jest-api.js';
export { expect as argusExpect } from '../src/matchers.js';

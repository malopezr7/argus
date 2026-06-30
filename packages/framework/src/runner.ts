/**
 * @argus/framework — pure test-tree runner.
 *
 * Extracted from index.ts so the SAME runner is exercised by BOTH execution
 * paths instead of being re-implemented per path:
 *  - the in-Hermes entry (index.ts `run()`, which owns the captured primordials,
 *    the hand-written serializer, and the framed result-line emission), and
 *  - the Vitest unit tests (via `__tests__/run-harness.ts`).
 *
 * RESULT-CHANNEL boundary: this module references NEITHER `print` NOR the
 * serializer. Its only ambient dependency — the time source — is INJECTED via
 * `createRunner(now)`, so the file stays free of module-eval primordials and is
 * safe to import in Node (where `print` does not exist).
 *
 * Hermes 0.17 envelope rules (this file is bundled into the sealed bundle):
 *  - No async arrows (async () =>) — use named async function declarations.
 *  - No for..of, no spread, no Array.prototype methods. Index loops only.
 */

import {
  type IdempotentGuard,
  runAfterAll,
  runAfterEachChain,
  runBeforeAll,
  runBeforeEachChain,
} from './hooks.js';
import {
  computeHasOnly,
  effectivelySkipped,
  getRootChildren,
  included,
  type PendingSuite,
  type PendingTest,
  subtreeHasOnly,
} from './jest-api.js';
import { resetAssertions, verifyAssertions } from './matchers.js';
import { autoResetMocks } from './mock-fn.js';

// ---------------------------------------------------------------------------
// Result types — the runner's output contract.
// ---------------------------------------------------------------------------

export interface TestCaseResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  failureMessage?: string;
  failureStack?: string;
  durationMs: number;
}
export interface SuiteResult {
  name: string;
  suites: SuiteResult[];
  tests: TestCaseResult[];
}
export interface RunResult {
  suites: SuiteResult[];
  totals: Totals;
  durationMs: number;
}
export type Totals = {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  total: number;
};

export interface Runner {
  /** Run every registered root suite and return the aggregated result. */
  runRoot(): Promise<RunResult>;
}

// ---------------------------------------------------------------------------
// Runner factory — closes over the injected time source `now`. Everything below
// is the real runner logic; index.ts and run-harness.ts both drive it.
// ---------------------------------------------------------------------------

export function createRunner(now: () => number): Runner {
  async function runTest(
    t: PendingTest,
    totals: Totals,
    chain: PendingSuite[],
    beforeAllError?: Error,
  ): Promise<TestCaseResult> {
    const t0 = now();
    totals.total++;

    // --- todo ---
    if (t.mode === 'todo') {
      totals.todo++;
      return { name: t.name, status: 'todo', durationMs: now() - t0 };
    }

    // --- skipped (by .skip mode or .only focus silencing) ---
    if (t.mode === 'skip') {
      totals.skipped++;
      return { name: t.name, status: 'skipped', durationMs: now() - t0 };
    }

    // --- beforeAll inherited error: all tests in this block fail, no hooks ---
    if (beforeAllError !== undefined) {
      totals.failed++;
      return {
        name: t.name,
        status: 'failed',
        failureMessage: beforeAllError.message,
        failureStack: beforeAllError.stack,
        durationMs: now() - t0,
      };
    }

    // --- normal execution ---
    resetAssertions();
    autoResetMocks();

    const beErr = await runBeforeEachChain(chain);
    if (beErr !== undefined) {
      // beforeEach threw: fail the test, skip body, still run afterEach
      const aeErr = await runAfterEachChain(chain);
      totals.failed++;
      const msg =
        aeErr !== undefined ? `${beErr.message}; afterEach: ${aeErr.message}` : beErr.message;
      return {
        name: t.name,
        status: 'failed',
        failureMessage: msg,
        durationMs: now() - t0,
      };
    }

    let testErr: Error | undefined;
    try {
      await t.fn?.();
    } catch (e) {
      testErr = e instanceof Error ? e : new Error(String(e));
    }

    const aeErr = await runAfterEachChain(chain);

    // Verify assertion count after body + afterEach resolve
    const assertErr = verifyAssertions();

    if (testErr !== undefined) {
      totals.failed++;
      const extra = aeErr !== undefined ? ` (afterEach: ${aeErr.message})` : '';
      return {
        name: t.name,
        status: 'failed',
        failureMessage: testErr.message + extra,
        failureStack: testErr.stack,
        durationMs: now() - t0,
      };
    }
    if (aeErr !== undefined) {
      totals.failed++;
      return {
        name: t.name,
        status: 'failed',
        failureMessage: aeErr.message,
        failureStack: aeErr.stack,
        durationMs: now() - t0,
      };
    }
    if (assertErr !== undefined) {
      totals.failed++;
      return {
        name: t.name,
        status: 'failed',
        failureMessage: assertErr.message,
        durationMs: now() - t0,
      };
    }

    totals.passed++;
    return { name: t.name, status: 'passed', durationMs: now() - t0 };
  }

  function suiteHasIncludedDescendant(
    suite: PendingSuite,
    selfSkipped: boolean,
    ancestorsHaveOnly: boolean,
    hasOnly: boolean,
  ): boolean {
    for (let i = 0; i < suite.children.length; i++) {
      const child = suite.children[i];
      if (child.kind === 'test') {
        // todo placeholders are reported but never executed → NOT a hook-triggering
        // descendant (REQ-14): a todo-only suite must not run beforeAll/afterAll.
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
    const tests: TestCaseResult[] = [];
    const suites: SuiteResult[] = [];

    const selfSkipped = effectivelySkipped(suite, ancestorSkipped);
    const selfHasOnly = suite.mode === 'only';
    // D2: ancestorsHaveOnly propagates "select-all" only when the .only block
    // has NO deeper .only that re-narrows it. If this suite is .only AND its
    // subtree has a deeper .only, children must match .only themselves.
    const selfSelectsAll = selfHasOnly && !subtreeHasOnly(suite, selfSkipped);
    const childAncestorsHaveOnly = ancestorsHaveOnly || selfSelectsAll;

    // Build chain for this suite's descendants (without spread, without push)
    const nextChain: PendingSuite[] = [];
    for (let k = 0; k < chain.length; k++) {
      nextChain[k] = chain[k];
    }
    nextChain[nextChain.length] = suite;

    const guard: IdempotentGuard = { ran: false };
    let suiteBeforeAllError: Error | undefined = inheritedBeforeAllError;

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
          // Silenced by focus — report as skipped
          totals.total++;
          totals.skipped++;
          tests[tests.length] = { name: child.name, status: 'skipped', durationMs: 0 };
          continue;
        }

        // Run beforeAll once before the first EXECUTABLE test. A todo placeholder
        // is reported (via runTest) but MUST NOT trigger lifecycle hooks (REQ-14).
        if (child.mode !== 'todo' && suiteBeforeAllError === undefined) {
          const baErr = await runBeforeAll(suite, guard);
          if (baErr !== undefined) {
            suiteBeforeAllError = baErr;
          }
        }

        tests[tests.length] = await runTest(child, totals, nextChain, suiteBeforeAllError);
      } else {
        // child is a suite — run this suite's beforeAll before descending, but ONLY
        // if the child subtree has an executable (non-todo) descendant (REQ-14).
        const childHasExecutable = suiteHasIncludedDescendant(
          child,
          effectivelySkipped(child, selfSkipped),
          childAncestorsHaveOnly,
          hasOnly,
        );
        if (childIncluded && childHasExecutable && suiteBeforeAllError === undefined) {
          const baErr = await runBeforeAll(suite, guard);
          if (baErr !== undefined) {
            suiteBeforeAllError = baErr;
          }
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

    // Run afterAll after all children drain
    if (hasDescendants || inheritedBeforeAllError !== undefined) {
      const aaErr = await runAfterAll(suite);
      if (aaErr !== undefined) {
        // Synthetic failed test for afterAll throw (D3)
        totals.total++;
        totals.failed++;
        tests[tests.length] = {
          name: 'afterAll hook',
          status: 'failed',
          failureMessage: aaErr.message,
          failureStack: aaErr.stack,
          durationMs: 0,
        };
      }
    }

    return { name: suite.name, suites, tests };
  }

  async function runRoot(): Promise<RunResult> {
    const start = now();
    const totals: Totals = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
    const rootNodes = getRootChildren();
    // Pass-1: compute file-global hasOnly (skipping effectively-skipped subtrees)
    const hasOnly = computeHasOnly(rootNodes, false);

    const suites: SuiteResult[] = [];
    for (let i = 0; i < rootNodes.length; i++) {
      const node = rootNodes[i];
      if (node.kind === 'suite') {
        suites[suites.length] = await runSuite(node, totals, [], hasOnly, false, false);
      }
    }
    return { suites, totals, durationMs: now() - start };
  }

  return { runRoot };
}

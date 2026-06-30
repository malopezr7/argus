/**
 * @argus/framework — in-Hermes micro test framework.
 *
 * Runs INSIDE the Hermes VM (bundled into the sealed bundle). Constraints:
 *  - `print()` is the only stdout primitive; NO console/process/Node.
 *  - Dependency-free; emits EXACTLY ONE framed result line:
 *      `__ARGUS_RESULT__:<nonce>:<json-envelope>`
 *    with the per-run secret <nonce> passed PRIVATELY to run(nonce).
 *
 * RESULT-CHANNEL INTEGRITY (defence-in-depth against in-realm tampering). User
 * test code runs in the SAME realm, so it can override globals and pollute
 * prototypes. The result channel therefore:
 *  1. Captures the function primordials it needs at module-eval time (BEFORE any
 *     user code runs): `safePrint`, `safeDateNow`. Matcher equality uses
 *     `Object.is` directly in `matchers.ts` (outside the result channel).
 *  2. Serializes the result with a HAND-WRITTEN serializer that uses ONLY
 *     un-pollutable language primitives — own-property access (`.length`,
 *     indices), operators, and string/array literals. It never calls
 *     `JSON.stringify` (which consults `Object.prototype.toJSON`), array methods
 *     (`push`/`map`), or the iterator protocol (`for..of`). So prototype
 *     pollution cannot forge a passing envelope or skip registered tests.
 *  (Full isolation against an adversarial test that pollutes deep language
 *   primitives is only achievable with realm/process isolation — see SPEC §9.)
 *
 * Async tests are supported (Hermes drains the microtask queue before exit);
 * timers are NOT available, and a test MUST return/await any Promise it creates.
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
  installGlobals,
  type PendingSuite,
  type PendingTest,
  resetRegistry,
  subtreeHasOnly,
} from './jest-api.js';
import { expect, resetAssertions, verifyAssertions } from './matchers.js';

export { expect, show } from './matchers.js';

declare function print(message: string): void;

// Captured primordials — taken NOW, before user code can replace the globals.
const safePrint = print;
const safeDateNow = Date.now;

// MUST stay in sync with ARGUS_RESULT_PREFIX in @argus/core.
const ARGUS_RESULT_PREFIX = '__ARGUS_RESULT__:';

interface TestCaseResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  failureMessage?: string;
  failureStack?: string;
  durationMs: number;
}
interface SuiteResult {
  name: string;
  suites: SuiteResult[];
  tests: TestCaseResult[];
}
interface RunResult {
  suites: SuiteResult[];
  totals: Totals;
  durationMs: number;
}
type Totals = { passed: number; failed: number; skipped: number; todo: number; total: number };

// Date.now() exists in standalone Hermes; performance.now() does not.
function now(): number {
  return safeDateNow();
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

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

/**
 * Execute all registered suites and print the single framed result line.
 * @param nonce - per-run secret, passed privately by the virtual entry.
 */
export async function run(nonce: string): Promise<void> {
  const start = now();
  const totals: Totals = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  try {
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
    const result: RunResult = { suites, totals, durationMs: now() - start };
    safePrint(`${ARGUS_RESULT_PREFIX + nonce}:${serOkEnvelope(result)}`);
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    const message = e?.message ? e.message : `${err as never}`;
    safePrint(`${ARGUS_RESULT_PREFIX + nonce}:${serErrEnvelope(message, e?.stack)}`);
  } finally {
    // Idempotent: clear the registry so a second run() does not re-run old suites.
    resetRegistry();
  }
}

// ---------------------------------------------------------------------------
// Hand-written serializer — uses ONLY un-pollutable primitives (own-property
// access, indices, operators, literals). No JSON.stringify / array methods /
// iterators, so prototype pollution cannot rewrite or skip the result.
// ---------------------------------------------------------------------------

function serOkEnvelope(result: RunResult): string {
  return `{"v":1,"ok":true,"result":${serResult(result)}}`;
}

function serErrEnvelope(message: string, stack: string | undefined): string {
  let out = `{"v":1,"ok":false,"error":{"message":${serStr(message)}`;
  if (stack !== undefined) out += `,"stack":${serStr(stack)}`;
  return `${out}}}`;
}

function serResult(r: RunResult): string {
  return (
    '{"suites":' +
    serSuites(r.suites) +
    ',"totals":' +
    serTotals(r.totals) +
    ',"durationMs":' +
    serInt(r.durationMs) +
    '}'
  );
}

function serTotals(t: Totals): string {
  return (
    '{"passed":' +
    serInt(t.passed) +
    ',"failed":' +
    serInt(t.failed) +
    ',"skipped":' +
    serInt(t.skipped) +
    ',"todo":' +
    serInt(t.todo) +
    ',"total":' +
    serInt(t.total) +
    '}'
  );
}

function serSuites(suites: SuiteResult[]): string {
  let out = '[';
  for (let i = 0; i < suites.length; i++) {
    if (i > 0) out += ',';
    out += serSuite(suites[i]);
  }
  return `${out}]`;
}

function serSuite(s: SuiteResult): string {
  return (
    '{"name":' +
    serStr(s.name) +
    ',"suites":' +
    serSuites(s.suites) +
    ',"tests":' +
    serTests(s.tests) +
    '}'
  );
}

function serTests(tests: TestCaseResult[]): string {
  let out = '[';
  for (let i = 0; i < tests.length; i++) {
    if (i > 0) out += ',';
    out += serTest(tests[i]);
  }
  return `${out}]`;
}

function serTest(t: TestCaseResult): string {
  let out = `{"name":${serStr(t.name)},"status":${serStr(t.status)}`;
  if (t.failureMessage !== undefined) out += `,"failureMessage":${serStr(t.failureMessage)}`;
  if (t.failureStack !== undefined) out += `,"failureStack":${serStr(t.failureStack)}`;
  out += `,"durationMs":${serInt(t.durationMs)}`;
  return `${out}}`;
}

function serStr(value: string): string {
  const s = typeof value === 'string' ? value : `${value as never}`;
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c === '\b') out += '\\b';
    else if (c === '\f') out += '\\f';
    else out += c;
  }
  return `${out}"`;
}

const DIGITS = '0123456789';
function serInt(n: number): string {
  if (typeof n !== 'number') return '0';
  const neg = n < 0;
  let x = neg ? -n : n;
  x = x - (x % 1); // drop fractional part without Math.floor
  if (x === 0) return '0';
  let out = '';
  while (x > 0) {
    const d = x % 10;
    out = DIGITS[d] + out;
    x = (x - d) / 10;
  }
  return neg ? `-${out}` : out;
}

// Install the test API as globals (Jest style). Runs at framework load.
const g = (
  typeof globalThis !== 'undefined' ? globalThis : ({} as Record<string, unknown>)
) as Record<string, unknown>;
g.expect = expect;
installGlobals(g);

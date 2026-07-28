/**
 * @arguslab/framework — in-Hermes micro test framework.
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

import { installArgusNamespace } from './argus-namespace.js';
import { installGlobals, resetRegistry } from './jest-api.js';
import { expect } from './matchers.js';
import {
  createRunner,
  type RunResult,
  type SuiteResult,
  type TestCaseResult,
  type Totals,
} from './runner.js';

export { expect, show } from './matchers.js';

declare function print(message: string): void;

// Captured primordials — taken NOW, before user code can replace the globals.
const safePrint = print;
const safeDateNow = Date.now;

// MUST stay in sync with ARGUS_RESULT_PREFIX in @arguslab/core.
const ARGUS_RESULT_PREFIX = '__ARGUS_RESULT__:';

// Date.now() exists in standalone Hermes; performance.now() does not.
function now(): number {
  return safeDateNow();
}

// The real runner lives in runner.ts (no print/serializer/primordials there).
// Inject the captured-primordial-backed time source so it stays portable.
const runner = createRunner(now);

/**
 * Execute all registered suites and print the single framed result line.
 * @param nonce - per-run secret, passed privately by the virtual entry.
 */
export async function run(nonce: string): Promise<void> {
  try {
    const result = await runner.runRoot();
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
installArgusNamespace(g);

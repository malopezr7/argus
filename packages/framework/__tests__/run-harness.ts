/**
 * Test harness: drives the REAL Argus runner for Vitest unit tests.
 *
 * index.ts captures `print` at module-eval time (before any user code), so it
 * cannot be imported in Node/Vitest (print is undefined there). The runner
 * logic, however, lives in `src/runner.ts` with NO result-channel concerns —
 * its only ambient dependency (the time source) is injected. So these unit
 * tests exercise the SAME runner that ships in Hermes, NOT a re-implementation:
 * a behavior change in runner.ts now shows up here as a failing test.
 *
 * The real integration path (full pipeline + Hermes + hand-written serializer)
 * is covered by `examples/jest-api.test.ts` run via `pnpm argus`.
 */

import { resetRegistry } from '../src/jest-api.js';
import {
  createRunner,
  type RunResult,
  type SuiteResult,
  type TestCaseResult,
} from '../src/runner.js';

// Node-side time source. Durations are not asserted by the unit tests; this
// only satisfies the runner's injected dependency.
const runner = createRunner(Date.now);

/** Flatten all tests from all suites recursively. */
export function flattenTests(suites: SuiteResult[]): TestCaseResult[] {
  const out: TestCaseResult[] = [];
  function walk(s: SuiteResult): void {
    for (const t of s.tests) out.push(t);
    for (const c of s.suites) walk(c);
  }
  for (const s of suites) walk(s);
  return out;
}

/**
 * Reset the registry, register suites via `setup`, then run them on the real
 * runner and return the aggregated result.
 */
export async function runWith(setup: () => void): Promise<RunResult> {
  resetRegistry();
  setup();
  const result = await runner.runRoot();
  resetRegistry();
  return result;
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
export type { RunResult, SuiteResult, TestCaseResult } from '../src/runner.js';

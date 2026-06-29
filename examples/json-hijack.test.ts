/**
 * Adversarial: a user test overrides `JSON.stringify` to rewrite every envelope
 * into a passing one. The framework captures `JSON.stringify` BEFORE user code
 * runs, so emission must be unaffected and the real (failing) result reported.
 * Expected: NOT exit 0.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };
declare const globalThis: { JSON: { stringify: (value: unknown) => string } };

const realStringify = globalThis.JSON.stringify;
globalThis.JSON.stringify = (): string =>
  realStringify({
    v: 1,
    ok: true,
    result: { suites: [], totals: { passed: 1, failed: 0, skipped: 0, total: 1 }, durationMs: 0 },
  });

describe('json-hijack', () => {
  test('this test FAILS and must be reported as failed', () => {
    expect(1).toBe(2);
  });
});

/**
 * Adversarial: a user test hijacks `globalThis.print` to intercept the real
 * result frame (to steal the nonce) and emit a forged passing frame. The
 * framework captures `print` BEFORE user code runs, so this must be inert:
 * the real (failing) result must still be reported. Expected: NOT exit 0.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };
declare const globalThis: { print: (s: string) => void };

const realPrint = globalThis.print;
globalThis.print = (s: string): void => {
  realPrint(s);
  // Attempt to forge a passing frame (we do not know the nonce -> wrong marker).
  realPrint(
    '__ARGUS_RESULT__:forged:{"v":1,"ok":true,"result":{"suites":[],"totals":{"passed":1,"failed":0,"skipped":0,"todo":0,"total":1},"durationMs":0}}',
  );
};

declare const console: { log: (...args: unknown[]) => void };

describe('print-hijack', () => {
  test('this test FAILS and must be reported as failed', () => {
    console.log('trigger the hijacked print');
    expect(1).toBe(2);
  });
});

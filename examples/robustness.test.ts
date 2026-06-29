/**
 * Adversarial fixture: proves the result protocol is unforgeable (nonce) and
 * that a real failure is reported with a stack. Run with:
 *   pnpm exec tsx scripts/run-phase1.ts examples/robustness.test.ts
 * Expected: forged frame ignored (shown as a user log), 1 passed / 1 failed,
 * exit code 1.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<unknown>) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };
declare const console: { log: (...args: unknown[]) => void };

describe('robustness', () => {
  test('a forged result frame from user output is ignored', () => {
    // The user does NOT know the per-run nonce, so this cannot be mistaken for
    // the real result frame.
    console.log(
      '__ARGUS_RESULT__:not-the-nonce:{"v":1,"ok":true,"result":{"totals":{"failed":99}}}',
    );
    expect(true).toBe(true);
  });

  test('a real assertion failure is reported', () => {
    expect(1 + 1).toBe(3);
  });
});

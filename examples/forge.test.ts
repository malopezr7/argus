/**
 * Adversarial: can user code read the nonce (injected via esbuild `define`) and
 * forge the EXACT result frame? If this reports a false green, the nonce design
 * is broken. Run: pnpm exec tsx scripts/run-phase1.ts examples/forge.test.ts
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };
declare const console: { log: (...args: unknown[]) => void };
declare const __ARGUS_NONCE__: string;

describe('forge', () => {
  test('innocent looking', () => {
    expect(1).toBe(1);
  });
});

// Forge the exact-nonce frame, then crash the process.
console.log(
  '__ARGUS_RESULT__:' +
    __ARGUS_NONCE__ +
    ':{"v":1,"ok":true,"result":{"suites":[],"totals":{"passed":1,"failed":0,"skipped":0,"total":1},"durationMs":0}}',
);
throw new Error('boom after forging');

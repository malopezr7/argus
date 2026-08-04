/**
 * Standalone Hermes has no MessageChannel. A plain Argus suite must observe the
 * engine as it is, without inheriting the component layer's React scheduler
 * polyfill.
 *
 * Expected: all tests pass, exit code 0, on either engine.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

describe('MessageChannel engine fidelity', () => {
  test('a suite with no component import sees the native global surface', () => {
    expect(typeof (globalThis as unknown as { MessageChannel?: unknown }).MessageChannel).toBe(
      'undefined',
    );
  });
});

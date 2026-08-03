/**
 * Deliberately failing test fixture for source-map integration testing.
 * This file is intentionally NOT included in the Vitest suite (examples/ is excluded).
 * It is run via `pnpm argus` directly (on Hermes) in the integration test.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<unknown>) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

describe('math-failing', () => {
  test('intentionally fails', () => {
    expect(1).toBe(2); // line 12 — assertion that always fails
  });
});

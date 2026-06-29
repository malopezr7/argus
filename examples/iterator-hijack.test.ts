/**
 * Adversarial: pollute `Array.prototype[Symbol.iterator]` so any `for..of`
 * yields nothing (which would silently skip suites/tests → false green). The
 * framework uses index-based loops, so this must be inert. Expected: NOT exit 0.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any)[Symbol.iterator] = () => ({
  next: () => ({ done: true, value: undefined }),
});

describe('iterator-hijack', () => {
  test('this test FAILS and must be reported as failed', () => {
    expect(1).toBe(2);
  });
});

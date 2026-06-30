/**
 * Adversarial: pollute `Object.prototype.toJSON` so a generic `JSON.stringify`
 * would forge a passing envelope. The framework's hand-written serializer never
 * calls JSON.stringify, so this must be inert. Expected: NOT exit 0.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Object.prototype as any).toJSON = () => ({
  v: 1,
  ok: true,
  result: {
    suites: [],
    totals: { passed: 1, failed: 0, skipped: 0, todo: 0, total: 1 },
    durationMs: 0,
  },
});

describe('tojson-hijack', () => {
  test('this test FAILS and must be reported as failed', () => {
    expect(1).toBe(2);
  });
});

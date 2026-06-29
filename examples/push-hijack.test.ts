/**
 * Adversarial: pollute `Array.prototype.push` before registration so a naive
 * registry would drop the registered tests (→ false green). The framework
 * appends via index assignment, not push, so this must be inert. Expected: NOT
 * exit 0.
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Array.prototype as any).push = () => 0;

describe('push-hijack', () => {
  test('this test FAILS and must be reported as failed', () => {
    expect(1).toBe(2);
  });
});

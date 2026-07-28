/**
 * Sample Argus test. `describe`/`test`/`expect` are installed as globals by
 * @arguslab/framework, so no import is needed (Jest style).
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<unknown>) => void;
declare const expect: (actual: unknown) => { toBe(expected: unknown): void };

describe('math', () => {
  test('adds small numbers', () => {
    expect(1 + 1).toBe(2);
  });

  describe('nested', () => {
    test('multiplies', () => {
      expect(6 * 7).toBe(42);
    });
  });

  test('resolves async (microtask)', async () => {
    const value = await Promise.resolve(7);
    expect(value).toBe(7);
  });
});

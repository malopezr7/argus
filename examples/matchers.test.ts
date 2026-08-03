/**
 * Matchers integration fixture — exercises expect() matchers on real Hermes.
 * Run with: pnpm argus examples/matchers.test.ts
 * Expected: exit 0 (all tests pass).
 */
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<unknown>) => void;
declare const expect: <T>(actual: T) => {
  toBe(expected: T): void;
  not: { toBe(expected: T): void };
  toEqual(expected: T): void;
  toStrictEqual(expected: T): void;
  toContainEqual(item: unknown): void;
  toHaveProperty(path: string, value?: unknown): void;
  toThrow(expected?: unknown): void;
  toBeGreaterThan(n: number): void;
  toContain(item: unknown): void;
  toMatch(pattern: string | RegExp): void;
  toBeTruthy(): void;
  toBeNull(): void;
};

describe('matchers integration', () => {
  test('toEqual — same-shape object', () => {
    expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
  });

  test('toStrictEqual — primitive equality', () => {
    expect(42).toStrictEqual(42);
  });

  test('toContainEqual — finds structurally equal element', () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(arr).toContainEqual({ id: 2 });
  });

  test('toHaveProperty — dotted path', () => {
    expect({ user: { name: 'Ana', role: 'admin' } }).toHaveProperty('user.name', 'Ana');
  });

  test('toThrow — catches error by message substring', () => {
    expect(() => {
      throw new Error('disk full');
    }).toThrow('disk');
  });

  test('.not.toBe — different references are not the same', () => {
    const objA = { x: 1 };
    const objB = { x: 1 };
    expect(objA).not.toBe(objB);
  });

  test('toBeGreaterThan — numeric comparison', () => {
    expect(10).toBeGreaterThan(5);
  });

  test('toContain — NaN via SameValueZero', () => {
    expect([1, NaN, 3]).toContain(NaN);
  });

  test('toMatch — RegExp on string', () => {
    expect('hello world').toMatch(/world/);
  });

  test('toBeTruthy — non-empty string', () => {
    expect('argus').toBeTruthy();
  });
});

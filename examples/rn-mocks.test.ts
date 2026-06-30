/**
 * RN native mocks integration fixture — run with: pnpm argus examples/rn-mocks.test.ts
 */
// @ts-expect-error Argus aliases react-native to its in-realm shim at bundle time.
import { NativeModules, TurboModuleRegistry } from 'react-native';

declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<unknown>) => void;
declare const expect: (actual: unknown) => {
  readonly not: ReturnType<typeof expect>;
  readonly resolves: {
    toHaveBeenCalledWith(...args: unknown[]): Promise<void>;
    toHaveReturnedWith(value: unknown): Promise<void>;
  };
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(n: number): void;
  toHaveBeenCalledWith(...args: unknown[]): void;
  toHaveBeenLastCalledWith(...args: unknown[]): void;
  toHaveBeenNthCalledWith(n: number, ...args: unknown[]): void;
  toHaveReturned(): void;
  toHaveReturnedTimes(n: number): void;
  toHaveReturnedWith(value: unknown): void;
  toHaveLastReturnedWith(value: unknown): void;
  toHaveNthReturnedWith(n: number, value: unknown): void;
};
declare const argus: {
  fn(impl?: (...args: unknown[]) => unknown): {
    (...args: unknown[]): unknown;
    mockReturnValue(v: unknown): unknown;
    mockReturnValueOnce(v: unknown): unknown;
  };
  spyOn<T extends Record<string, unknown>>(
    obj: T,
    method: keyof T,
  ): (...args: unknown[]) => unknown;
  mockNativeModule(name: string, factory: () => unknown): void;
  resetNativeModules(): void;
  jest?: unknown;
};

describe('RN native mocks on Hermes', () => {
  test('argus namespace exists and jest namespace does not', () => {
    expect(typeof argus.fn).toBe('function');
    expect(globalThis.jest).toBeUndefined();
    expect(argus.jest).toBeUndefined();
  });

  test('registered native mock resolves through react-native shim', () => {
    argus.resetNativeModules();
    argus.mockNativeModule('Foo', function makeFoo() {
      return { bar: argus.fn() };
    });

    var foo = TurboModuleRegistry.getEnforcing('Foo');
    foo.bar('hi');

    expect(NativeModules.Foo).toBe(foo);
    expect(foo.bar).toHaveBeenCalled();
    expect(foo.bar).toHaveBeenCalledWith('hi');
    expect(TurboModuleRegistry.get('Missing')).toBe(null);
  });

  test('call and return matchers all pass on Hermes', () => {
    var f = argus.fn(function plusOne(x) {
      return x + 1;
    });

    f('a');
    f(1);
    f(9);

    expect(f).toHaveBeenCalled();
    expect(f).toHaveBeenCalledTimes(3);
    expect(f).toHaveBeenCalledWith(1);
    expect(f).toHaveBeenLastCalledWith(9);
    expect(f).toHaveBeenNthCalledWith(1, 'a');
    expect(f).toHaveReturned();
    expect(f).toHaveReturnedTimes(3);
    expect(f).toHaveReturnedWith(10);
    expect(f).toHaveLastReturnedWith(10);
    expect(f).toHaveNthReturnedWith(2, 2);
    expect(f).not.toHaveBeenCalledWith('missing');
  });

  test('spy records and delegates', () => {
    var obj = {
      m: function m(x) {
        return x * 2;
      },
    };
    var spy = argus.spyOn(obj, 'm');

    expect(obj.m(4)).toBe(8);
    expect(spy).toHaveBeenCalledWith(4);
  });

  test('mockReturnValueOnce drains FIFO on Hermes', () => {
    var f = argus.fn();
    f.mockReturnValue('default');
    f.mockReturnValueOnce('first');
    f.mockReturnValueOnce('second');

    expect([f(), f(), f()]).toEqual(['first', 'second', 'default']);
  });
});

import { describe, expect, it } from 'vitest';
import { argusFn, argusSpyOn } from '../src/mock-fn.js';
import {
  describe as argusDescribe,
  argusExpect,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('argusFn', () => {
  it('records calls in invocation order', () => {
    const f = argusFn();

    f(1);
    f(2, 3);

    expect(f.mock.calls).toEqual([[1], [2, 3]]);
  });

  it('returns undefined without behaviour and records a return result', () => {
    const f = argusFn();

    const result = f('x');

    expect(result).toBeUndefined();
    expect(f.mock.results).toEqual([{ type: 'return', value: undefined }]);
  });

  it('runs the implementation and records the returned value', () => {
    const f = argusFn(function add(a, b) {
      return (a as number) + (b as number);
    });

    const result = f(2, 5);

    expect(result).toBe(7);
    expect(f.mock.results).toEqual([{ type: 'return', value: 7 }]);
  });

  it('propagates throwing implementations and records a throw result', () => {
    const boom = new Error('boom');
    const f = argusFn(function fail() {
      throw boom;
    });

    expect(() => f()).toThrow('boom');
    expect(f.mock.results[0]).toEqual({ type: 'throw', value: boom });
  });

  it('records the call this-value in mock.instances', () => {
    const thisArg = { tag: 'receiver' };
    const f = argusFn();

    f.call(thisArg, 'value');

    expect(f.mock.instances[0]).toBe(thisArg);
  });

  it('mockReturnValue sets a persistent return value', () => {
    const f = argusFn();

    f.mockReturnValue(42);

    expect(f()).toBe(42);
    expect(f()).toBe(42);
  });

  it('mockReturnValueOnce drains FIFO then falls back to the default', () => {
    const f = argusFn();

    f.mockReturnValue('default');
    f.mockReturnValueOnce('a');
    f.mockReturnValueOnce('b');

    expect([f(), f(), f()]).toEqual(['a', 'b', 'default']);
  });

  it('mockImplementationOnce drains FIFO then falls back to the default implementation', () => {
    const f = argusFn(function base() {
      return 'base';
    });

    f.mockImplementation(function persistent() {
      return 'persistent';
    });
    f.mockImplementationOnce(function first() {
      return 'first';
    });
    f.mockImplementationOnce(function second() {
      return 'second';
    });

    expect([f(), f(), f()]).toEqual(['first', 'second', 'persistent']);
  });

  it('mockClear empties records but keeps behaviour', () => {
    const f = argusFn(function value() {
      return 9;
    });
    f();
    f();

    f.mockClear();

    expect(f.mock.calls).toEqual([]);
    expect(f()).toBe(9);
  });

  it('mockReset clears records and behaviour', () => {
    const f = argusFn(function value() {
      return 9;
    });
    f.mockReturnValueOnce(1);
    f();

    f.mockReset();

    expect(f.mock.calls).toEqual([]);
    expect(f()).toBeUndefined();
  });

  it('mockResolvedValue returns a resolving Promise and records the returned Promise', async () => {
    const f = argusFn();
    f.mockResolvedValue(7);

    const result = f();

    expect(result).toBeInstanceOf(Promise);
    expect(f.mock.results[0]).toEqual({ type: 'return', value: result });
    await expect(result).resolves.toBe(7);
  });

  it('mockRejectedValue returns a rejecting Promise and records the returned Promise', async () => {
    const f = argusFn();
    const reason = new Error('nope');
    f.mockRejectedValue(reason);

    const result = f();

    expect(result).toBeInstanceOf(Promise);
    expect(f.mock.results[0]).toEqual({ type: 'return', value: result });
    await expect(result).rejects.toBe(reason);
  });

  it('argusSpyOn records calls and delegates to the original by default', () => {
    const obj = {
      m(x: number) {
        return x * 2;
      },
    };

    const spy = argusSpyOn(obj, 'm');

    expect(obj.m(4)).toBe(8);
    expect(spy.mock.calls).toEqual([[4]]);
  });

  it('mockRestore restores the original function by identity', () => {
    const obj = {
      m(x: number) {
        return x + 1;
      },
    };
    const original = obj.m;
    const spy = argusSpyOn(obj, 'm');

    spy.mockRestore();

    expect(obj.m).toBe(original);
    obj.m(1);
    expect(spy.mock.calls).toEqual([]);
  });

  it('a spy can override behaviour and still restore', () => {
    const obj = {
      m(x: number) {
        return x + 1;
      },
    };
    const original = obj.m;
    const spy = argusSpyOn(obj, 'm');

    spy.mockReturnValue(99);

    expect(obj.m(1)).toBe(99);
    spy.mockRestore();
    expect(obj.m).toBe(original);
    expect(obj.m(1)).toBe(2);
  });

  it('spyOn on a non-function property throws a guard Error', () => {
    const obj = { value: 1 };

    expect(() => argusSpyOn(obj, 'value')).toThrow(/function/);
  });

  it('mockReset on a spy clears original delegation until mockRestore', () => {
    const obj = {
      m(x: number) {
        return x * 3;
      },
    };
    const original = obj.m;
    const spy = argusSpyOn(obj, 'm');

    spy.mockReset();

    expect(obj.m(2)).toBeUndefined();
    spy.mockRestore();
    expect(obj.m).toBe(original);
    expect(obj.m(2)).toBe(6);
  });

  it('autoResetMocks clears records between runner tests', async () => {
    const f = argusFn();

    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('A', () => {
          f('first');
          argusExpect(f.mock.calls).toEqual([['first']]);
        });
        argusTest('B', () => {
          argusExpect(f.mock.calls).toEqual([]);
        });
      });
    });

    expect(flattenTests(result.suites).map((test) => test.status)).toEqual(['passed', 'passed']);
  });
});

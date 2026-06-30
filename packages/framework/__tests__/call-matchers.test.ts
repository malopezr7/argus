import { describe, expect, it } from 'vitest';
import { argusFn } from '../src/mock-fn.js';
import {
  describe as argusDescribe,
  argusExpect,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('call and return matchers', () => {
  it('passes all call matcher variants on a satisfied mock', () => {
    const f = argusFn();

    f('a');
    f({ nested: 1 });
    f('c');

    argusExpect(f).toHaveBeenCalled();
    argusExpect(f).toHaveBeenCalledTimes(3);
    argusExpect(f).toHaveBeenCalledWith({ nested: 1 });
    argusExpect(f).toHaveBeenLastCalledWith('c');
    argusExpect(f).toHaveBeenNthCalledWith(1, 'a');
  });

  it('passes all return matcher variants on a satisfied mock', () => {
    const f = argusFn(function addOne(x) {
      return (x as number) + 1;
    });

    f(1);
    f(9);

    argusExpect(f).toHaveReturned();
    argusExpect(f).toHaveReturnedTimes(2);
    argusExpect(f).toHaveReturnedWith(10);
    argusExpect(f).toHaveLastReturnedWith(10);
    argusExpect(f).toHaveNthReturnedWith(1, 2);
  });

  it('throws show-formatted failures for unsatisfied call and return matchers', () => {
    const f = argusFn(function value() {
      return 'ok';
    });
    f('actual');

    expect(() => argusExpect(f).toHaveBeenCalledTimes(2)).toThrow(/toHaveBeenCalledTimes/);
    expect(() => argusExpect(f).toHaveBeenCalledWith('missing')).toThrow(/toHaveBeenCalledWith/);
    expect(() => argusExpect(f).toHaveBeenLastCalledWith('missing')).toThrow(
      /toHaveBeenLastCalledWith/,
    );
    expect(() => argusExpect(f).toHaveBeenNthCalledWith(2, 'actual')).toThrow(
      /toHaveBeenNthCalledWith/,
    );
    expect(() => argusExpect(f).toHaveReturnedTimes(2)).toThrow(/toHaveReturnedTimes/);
    expect(() => argusExpect(f).toHaveReturnedWith('missing')).toThrow(/toHaveReturnedWith/);
    expect(() => argusExpect(f).toHaveLastReturnedWith('missing')).toThrow(
      /toHaveLastReturnedWith/,
    );
    expect(() => argusExpect(f).toHaveNthReturnedWith(2, 'ok')).toThrow(/toHaveNthReturnedWith/);
  });

  it('.not inverts call and return matchers', () => {
    const f = argusFn(function value() {
      return 'ok';
    });
    f(5);

    argusExpect(f).not.toHaveBeenCalledWith(6);
    argusExpect(f).not.toHaveBeenCalledTimes(2);
    argusExpect(f).not.toHaveReturnedWith('missing');
    expect(() => argusExpect(f).not.toHaveBeenCalled()).toThrow(/not\.toHaveBeenCalled/);
    expect(() => argusExpect(f).not.toHaveReturned()).toThrow(/not\.toHaveReturned/);
  });

  it('throws a guard Error when received value is not a mock', () => {
    expect(() => argusExpect(123).toHaveBeenCalled()).toThrow(/not a mock function/);
    expect(() => argusExpect(null).toHaveBeenCalled()).toThrow(/not a mock function/);
    expect(() => argusExpect(undefined).toHaveBeenCalled()).toThrow(/not a mock function/);
  });

  it('guard errors still increment assertion counting exactly once', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('guard count', () => {
          (argusExpect as unknown as { assertions(n: number): void }).assertions(1);
          try {
            argusExpect(123).toHaveBeenCalled();
          } catch (_e) {
            // guard error swallowed so verifyAssertions can check the count
          }
        });
      });
    });

    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });

  it('async resolves and rejects wrappers delegate to call matchers', async () => {
    const called = argusFn();
    called('x');
    const returned = argusFn(function value() {
      return 'ok';
    });
    returned();

    await argusExpect(Promise.resolve(called)).resolves.toHaveBeenCalledWith('x');
    await argusExpect(Promise.resolve(returned)).resolves.toHaveReturnedWith('ok');
    await argusExpect(Promise.reject(called)).rejects.not.toHaveBeenCalledWith('y');
  });
});

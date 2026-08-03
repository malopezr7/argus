/**
 * `it` is the very same function object as `test` — not a wrapper — so it
 * reports identically and carries the same .skip/.only/.todo modifiers.
 */
import { describe, expect, it } from 'vitest';
import {
  describe as argusDescribe,
  it as argusIt,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('it alias', () => {
  it('it === test is true', () => {
    expect(argusIt).toBe(argusTest);
  });

  it('it(name, fn) runs and reports passed identically to test(name, fn)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusIt('works', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('passed');
    expect(tests[0].name).toBe('works');
    expect(result.totals.passed).toBe(1);
  });

  it('it.skip/only/todo accessible and correct', async () => {
    expect(argusIt.skip).toBe(argusTest.skip);
    expect(argusIt.only).toBe(argusTest.only);
    expect(argusIt.todo).toBe(argusTest.todo);

    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusIt.skip('s', () => {
          throw new Error('must not run');
        });
      });
    });
    expect(flattenTests(result.suites)[0].status).toBe('skipped');
  });
});

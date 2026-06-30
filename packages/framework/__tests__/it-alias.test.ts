/**
 * it-alias.test.ts — AC-44, AC-45, AC-46
 */
import { describe, expect, it } from 'vitest';
import {
  describe as argusDescribe,
  it as argusIt,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('it alias (AC-44, AC-45, AC-46)', () => {
  it('it === test is true (AC-44)', () => {
    expect(argusIt).toBe(argusTest);
  });

  it('it(name, fn) runs and reports passed identically to test(name, fn) (AC-45)', async () => {
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

  it('it.skip/only/todo accessible and correct (AC-46)', async () => {
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

/**
 * The .skip modifier on test, it, and describe: the body is never called, the
 * status is reported as skipped, and tests outside the block are unaffected.
 */
import { describe, expect, it } from 'vitest';
import {
  describe as argusDescribe,
  it as argusIt,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('skip modifier', () => {
  it('test.skip body not called, status skipped, totals.skipped', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest.skip('skipped', () => {
          log.push('must not run');
        });
        argusTest('active', () => {});
      });
    });

    expect(log).not.toContain('must not run');
    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('skipped');
    expect(tests[1].status).toBe('passed');
    expect(result.totals.skipped).toBe(1);
    expect(result.totals.passed).toBe(1);
    expect(result.totals.total).toBe(2);
  });

  it('it.skip behaves identically to test.skip', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusIt.skip('skipped', () => {
          throw new Error('must not run');
        });
        argusIt('active', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('skipped');
    expect(tests[1].status).toBe('passed');
  });

  it('describe.skip skips all contained tests, outer tests unaffected', async () => {
    const result = await runWith(() => {
      argusDescribe('outer', () => {
        argusDescribe.skip('skipped block', () => {
          argusTest('T1', () => {
            throw new Error('must not run');
          });
          argusTest('T2', () => {
            throw new Error('must not run');
          });
        });
        argusTest('T3', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    const t1 = tests.find((t) => t.name === 'T1');
    const t2 = tests.find((t) => t.name === 'T2');
    const t3 = tests.find((t) => t.name === 'T3');
    expect(t1?.status).toBe('skipped');
    expect(t2?.status).toBe('skipped');
    expect(t3?.status).toBe('passed');
    expect(result.totals.skipped).toBe(2);
    expect(result.totals.total).toBe(3);
  });
});

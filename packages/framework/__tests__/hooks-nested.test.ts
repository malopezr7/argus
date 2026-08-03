/**
 * Nested hook ordering: outer beforeEach runs before inner, inner afterEach
 * before outer, beforeAll/afterAll nest the same way, and multiple hooks of the
 * same type on one block run in registration order.
 */
import { describe, expect, it } from 'vitest';
import {
  afterAll as argusAfterAll,
  afterEach as argusAfterEach,
  beforeAll as argusBeforeAll,
  beforeEach as argusBeforeEach,
  describe as argusDescribe,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('hooks nested ordering', () => {
  it('outer-BE before inner-BE, inner-AE before outer-AE', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('outer', () => {
        argusBeforeEach(() => {
          log.push('outer-BE');
        });
        argusAfterEach(() => {
          log.push('outer-AE');
        });
        argusDescribe('inner', () => {
          argusBeforeEach(() => {
            log.push('inner-BE');
          });
          argusAfterEach(() => {
            log.push('inner-AE');
          });
          argusTest('T', () => {
            log.push('T');
          });
        });
      });
    });

    expect(log).toEqual(['outer-BE', 'inner-BE', 'T', 'inner-AE', 'outer-AE']);
    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });

  it('nested beforeAll / afterAll ordering', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('outer', () => {
        argusBeforeAll(() => {
          log.push('outer-BA');
        });
        argusAfterAll(() => {
          log.push('outer-AA');
        });
        argusDescribe('inner', () => {
          argusBeforeAll(() => {
            log.push('inner-BA');
          });
          argusAfterAll(() => {
            log.push('inner-AA');
          });
          argusTest('T1', () => {
            log.push('T1');
          });
          argusTest('T2', () => {
            log.push('T2');
          });
        });
      });
    });

    expect(log).toEqual(['outer-BA', 'inner-BA', 'T1', 'T2', 'inner-AA', 'outer-AA']);
    // each fires exactly once
    expect(log.filter((x) => x === 'outer-BA')).toHaveLength(1);
    expect(log.filter((x) => x === 'outer-AA')).toHaveLength(1);
    expect(result.totals.passed).toBe(2);
  });

  it('multiple hooks same type on same block run in registration order', async () => {
    const log: string[] = [];
    await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeAll(() => {
          log.push('BA1');
        });
        argusBeforeAll(() => {
          log.push('BA2');
        });
        argusAfterAll(() => {
          log.push('AA1');
        });
        argusAfterAll(() => {
          log.push('AA2');
        });
        argusTest('T', () => {});
      });
    });

    expect(log.indexOf('BA1')).toBeLessThan(log.indexOf('BA2'));
    expect(log.indexOf('AA1')).toBeLessThan(log.indexOf('AA2'));
  });
});

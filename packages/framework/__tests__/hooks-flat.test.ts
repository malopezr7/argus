/**
 * hooks-flat.test.ts — AC-47: flat hook ordering
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

describe('hooks flat ordering (AC-47)', () => {
  it('log is [BA,BE,T1,AE,BE,T2,AE,AA] and both tests pass', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeAll(() => {
          log.push('BA');
        });
        argusAfterAll(() => {
          log.push('AA');
        });
        argusBeforeEach(() => {
          log.push('BE');
        });
        argusAfterEach(() => {
          log.push('AE');
        });
        argusTest('T1', () => {
          log.push('T1');
        });
        argusTest('T2', () => {
          log.push('T2');
        });
      });
    });

    expect(log).toEqual(['BA', 'BE', 'T1', 'AE', 'BE', 'T2', 'AE', 'AA']);
    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('passed');
    expect(tests[1].status).toBe('passed');
    expect(result.totals.passed).toBe(2);
  });

  it('multiple hooks same type run in registration order (AC-52)', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeEach(() => {
          log.push('BE1');
        });
        argusBeforeEach(() => {
          log.push('BE2');
        });
        argusAfterEach(() => {
          log.push('AE1');
        });
        argusAfterEach(() => {
          log.push('AE2');
        });
        argusTest('T1', () => {
          log.push('T1');
        });
      });
    });

    expect(log).toEqual(['BE1', 'BE2', 'T1', 'AE1', 'AE2']);
    expect(result.totals.passed).toBe(1);
  });
});

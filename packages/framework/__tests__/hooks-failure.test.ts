/**
 * Hook failure policy: a throwing hook fails the affected tests without
 * aborting the run, and the remaining hooks in the chain still execute.
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

describe('hook failure behavior', () => {
  it('throwing beforeEach: test failed, body not run, afterEach still runs', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeEach(() => {
          throw new Error('setup failed');
        });
        argusAfterEach(() => {
          log.push('cleanup-ran');
        });
        argusTest('T1', () => {
          log.push('body-ran');
        });
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('failed');
    expect(tests[0].failureMessage).toMatch(/setup failed/);
    expect(log).not.toContain('body-ran');
    expect(log).toContain('cleanup-ran');
  });

  it('throwing beforeAll: all block tests failed, afterAll still runs', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeAll(() => {
          throw new Error('global setup failed');
        });
        argusAfterAll(() => {
          log.push('global-cleanup');
        });
        argusTest('T1', () => {
          log.push('body1');
        });
        argusTest('T2', () => {
          log.push('body2');
        });
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('failed');
    expect(tests[1].status).toBe('failed');
    expect(log).toContain('global-cleanup');
    expect(log).not.toContain('body1');
    expect(log).not.toContain('body2');
  });

  it('throwing afterEach: test marked failed, remaining afterEach hooks still run', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusAfterEach(() => {
          throw new Error('afterEach-1 threw');
        });
        argusAfterEach(() => {
          log.push('afterEach-2-ran');
        });
        argusTest('T1', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('failed');
    expect(log).toContain('afterEach-2-ran');
  });

  it('throwing afterAll: synthetic "afterAll hook" failed test; other tests unaffected', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusAfterAll(() => {
          throw new Error('afterAll threw');
        });
        argusTest('T1', () => {});
        argusTest('T2', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    // T1 and T2 pass; synthetic afterAll hook test fails
    const passing = tests.filter((t) => t.name !== 'afterAll hook');
    const synthetic = tests.find((t) => t.name === 'afterAll hook');
    expect(passing.every((t) => t.status === 'passed')).toBe(true);
    expect(synthetic).toBeDefined();
    expect(synthetic?.status).toBe('failed');
    expect(synthetic?.failureMessage).toMatch(/afterAll threw/);
    expect(result.totals.failed).toBe(1);
    expect(result.totals.passed).toBe(2);
  });

  it('throwing afterAll: remaining afterAll hooks still run', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusAfterAll(() => {
          throw new Error('aa1 threw');
        });
        argusAfterAll(() => {
          log.push('aa2-ran');
        });
        argusTest('T1', () => {});
      });
    });

    expect(log).toContain('aa2-ran');
    const synthetic = flattenTests(result.suites).find((t) => t.name === 'afterAll hook');
    expect(synthetic?.status).toBe('failed');
  });
});

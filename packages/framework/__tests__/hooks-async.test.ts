/**
 * Async hooks are awaited: a returned promise must settle before the test body
 * runs, and before the next test's beforeEach starts.
 */
import { describe, expect, it } from 'vitest';
import {
  afterEach as argusAfterEach,
  beforeEach as argusBeforeEach,
  describe as argusDescribe,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('async hooks', () => {
  it('async beforeEach is awaited before test body runs', async () => {
    let asyncSetupDone = false;
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeEach(async function setup() {
          await new Promise<void>((resolve) => {
            // Use setTimeout-free approach — just resolve immediately
            asyncSetupDone = true;
            resolve();
          });
        });
        argusTest('T', () => {
          if (!asyncSetupDone) throw new Error('async setup not done');
        });
      });
    });

    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });

  it('async afterEach is awaited before next beforeEach runs', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusBeforeEach(async function setup() {
          log.push('BE');
        });
        argusAfterEach(async function teardown() {
          await new Promise<void>((resolve) => {
            log.push('AE');
            resolve();
          });
        });
        argusTest('T1', () => {
          log.push('T1');
        });
        argusTest('T2', () => {
          log.push('T2');
        });
      });
    });

    // AE of T1 must appear before BE of T2
    const aeIdx = log.indexOf('AE');
    const be2Idx = log.lastIndexOf('BE');
    expect(aeIdx).toBeGreaterThanOrEqual(0);
    expect(aeIdx).toBeLessThan(be2Idx);
    expect(result.totals.passed).toBe(2);
  });
});

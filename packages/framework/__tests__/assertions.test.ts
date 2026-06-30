/**
 * assertions.test.ts — AC-78, AC-79, AC-80, AC-81, AC-98
 */
import { describe, expect, it } from 'vitest';
import {
  describe as argusDescribe,
  argusExpect,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('expect.assertions / expect.hasAssertions', () => {
  it('expect.assertions(n) fails when count is low (AC-78)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('low count', () => {
          (argusExpect as unknown as { assertions(n: number): void }).assertions(2);
          argusExpect(1).toBe(1); // only 1
        });
      });
    });
    const t = flattenTests(result.suites)[0];
    expect(t.status).toBe('failed');
    expect(t.failureMessage).toMatch(/assertions\(2\)/);
  });

  it('expect.assertions(n) passes when exact count matched (AC-79)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('exact count', () => {
          (argusExpect as unknown as { assertions(n: number): void }).assertions(2);
          argusExpect(1).toBe(1);
          argusExpect(2).toBe(2);
        });
      });
    });
    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });

  it('expect.hasAssertions() fails when zero assertions ran (AC-80)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('zero assertions', () => {
          (argusExpect as unknown as { hasAssertions(): void }).hasAssertions();
          // no assertions
        });
      });
    });
    const t = flattenTests(result.suites)[0];
    expect(t.status).toBe('failed');
    expect(t.failureMessage).toMatch(/hasAssertions/);
  });

  it('assertion counter resets between tests (AC-81)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('T1', () => {
          (argusExpect as unknown as { assertions(n: number): void }).assertions(1);
          argusExpect(1).toBe(1);
        });
        argusTest('T2', () => {
          // No assertions(n) set; 3 assertions, should pass fine
          argusExpect(1).toBe(1);
          argusExpect(2).toBe(2);
          argusExpect(3).toBe(3);
        });
      });
    });
    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('passed');
    expect(tests[1].status).toBe('passed');
  });

  it('counter increments on pass AND fail (AC-98)', async () => {
    // We expect assertions(2); one passes, one fails -> count = 2 before throw
    // but the failed assertion throws, so the second one never runs...
    // Actually per D5: counter increments on EVERY assert call (pass or fail).
    // The throw happens AFTER the increment, so the counter still goes up on fail.
    // Test: assertions(1); one failing assertion → still fail on the assertion
    // but counter = 1 by then. The test fails because the assertion threw, not
    // because the count was wrong. Let's verify the count with hasAssertions:
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('count on fail', () => {
          (argusExpect as unknown as { hasAssertions(): void }).hasAssertions();
          try {
            argusExpect(1).toBe(2); // fails → throws, but counter should increment
          } catch (_e) {
            // swallow the error to let verifyAssertions run
          }
          // hasAssertions: count >= 1. Since counter incremented on the failing
          // assertion, this should pass the hasAssertions check.
        });
      });
    });
    // The test had 1 failing assertion that was caught.
    // hasAssertions should see count >= 1 → satisfied.
    // But the test catches the error, so the test itself passes.
    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });

  it('counter increments on a caught-failing .rejects.toThrow (AC-98, async path)', async () => {
    // D5: a .rejects.toThrow that fails (rejection does not match) MUST still
    // increment the counter, so hasAssertions is satisfied even though the
    // assertion failed and was caught.
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('async count on fail', async () => {
          (argusExpect as unknown as { hasAssertions(): void }).hasAssertions();
          try {
            await (
              argusExpect(Promise.reject(new Error('real error'))) as unknown as {
                rejects: { toThrow(s: string): Promise<void> };
              }
            ).rejects.toThrow('a different message'); // fails: message mismatch
          } catch (_e) {
            // swallow the assertion failure
          }
        });
      });
    });
    // If the failing .rejects.toThrow counted, hasAssertions passes → test passes.
    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });

  it('counter increments on a caught WRONG-SETTLEMENT async assertion (AC-98)', async () => {
    // D5: a .rejects.toBe on a RESOLVING promise (and a .resolves.toBe on a
    // REJECTING promise) fails on the wrong-settlement path — which never reaches
    // the sync matcher — and MUST still increment the counter.
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('wrong-settlement counts', async () => {
          (argusExpect as unknown as { hasAssertions(): void }).hasAssertions();
          try {
            await (
              argusExpect(Promise.resolve(1)) as unknown as {
                rejects: { toBe(v: unknown): Promise<void> };
              }
            ).rejects.toBe(1); // promise resolves but we asserted .rejects → wrong settlement
          } catch (_e) {
            // swallow
          }
        });
      });
    });
    expect(flattenTests(result.suites)[0].status).toBe('passed');
  });
});

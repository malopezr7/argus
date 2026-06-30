/**
 * focus.test.ts — AC-61, AC-62, AC-63, AC-64, AC-93, AC-94
 */
import { describe, expect, it } from 'vitest';
import {
  describe as argusDescribe,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('focus (.only) modifier', () => {
  it('test.only among siblings: focused passes, others skipped (AC-61)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('T1', () => {});
        argusTest.only('T2', () => {});
        argusTest('T3', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    const t1 = tests.find((t) => t.name === 'T1');
    const t2 = tests.find((t) => t.name === 'T2');
    const t3 = tests.find((t) => t.name === 'T3');
    expect(t2?.status).toBe('passed');
    expect(t1?.status).toBe('skipped');
    expect(t3?.status).toBe('skipped');
    expect(result.totals.passed).toBe(1);
    expect(result.totals.skipped).toBe(2);
    expect(result.totals.total).toBe(3);
  });

  it('describe.only runs all descendants, sibling describes silenced (AC-62)', async () => {
    const result = await runWith(() => {
      argusDescribe.only('A', () => {
        argusTest('A1', () => {});
        argusTest('A2', () => {});
      });
      argusDescribe('B', () => {
        argusTest('B1', () => {});
        argusTest('B2', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    const a1 = tests.find((t) => t.name === 'A1');
    const a2 = tests.find((t) => t.name === 'A2');
    const b1 = tests.find((t) => t.name === 'B1');
    const b2 = tests.find((t) => t.name === 'B2');
    expect(a1?.status).toBe('passed');
    expect(a2?.status).toBe('passed');
    expect(b1?.status).toBe('skipped');
    expect(b2?.status).toBe('skipped');
    expect(result.totals.passed).toBe(2);
    expect(result.totals.skipped).toBe(2);
  });

  it('no .only in file: all tests run normally (AC-63)', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('T1', () => {});
        argusTest('T2', () => {});
        argusTest('T3', () => {});
      });
    });

    expect(result.totals.passed).toBe(3);
    expect(result.totals.skipped).toBe(0);
  });

  it('test.only inside describe.only: only focused test runs — siblings skipped (AC-93/AC-64)', async () => {
    const result = await runWith(() => {
      argusDescribe.only('D', () => {
        argusTest.only('a', () => {});
        argusTest('b', () => {});
      });
      argusDescribe('sibling', () => {
        argusTest('c', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    const a = tests.find((t) => t.name === 'a');
    const b = tests.find((t) => t.name === 'b');
    const c = tests.find((t) => t.name === 'c');
    expect(a?.status).toBe('passed');
    expect(b?.status).toBe('skipped');
    expect(c?.status).toBe('skipped');
    expect(result.totals.passed).toBe(1);
    expect(result.totals.skipped).toBe(2);
  });

  it('.only inside describe.skip: no focus activation, rest of file runs (AC-94)', async () => {
    const result = await runWith(() => {
      argusDescribe.skip('D', () => {
        argusTest.only('a', () => {
          throw new Error('must not run');
        });
      });
      argusDescribe('outer', () => {
        argusTest('b', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    const a = tests.find((t) => t.name === 'a');
    const b = tests.find((t) => t.name === 'b');
    expect(a?.status).toBe('skipped'); // skip wins; .only ignored for hasOnly
    expect(b?.status).toBe('passed'); // rest of file runs normally
    expect(result.totals.passed).toBe(1);
  });
});

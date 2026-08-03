/**
 * test.todo / it.todo placeholders: reported with status todo, any body passed
 * is never executed, the totals invariant still holds, and a todo-only suite
 * does not trigger beforeAll/afterAll.
 */
import { describe, expect, it } from 'vitest';
import {
  afterAll as argusAfterAll,
  beforeAll as argusBeforeAll,
  describe as argusDescribe,
  it as argusIt,
  test as argusTest,
  flattenTests,
  runWith,
} from './run-harness.js';

describe('test.todo modifier', () => {
  it('test.todo registers placeholder, status todo, totals.todo++', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest.todo('not yet implemented');
        argusTest('implemented', () => {});
      });
    });

    const tests = flattenTests(result.suites);
    const todo = tests.find((t) => t.name === 'not yet implemented');
    const impl = tests.find((t) => t.name === 'implemented');
    expect(todo?.status).toBe('todo');
    expect(impl?.status).toBe('passed');
    expect(result.totals.todo).toBe(1);
    expect(result.totals.passed).toBe(1);
    expect(result.totals.total).toBe(2);
  });

  it('it.todo behaves identically to test.todo', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusIt.todo('pending');
      });
    });

    const tests = flattenTests(result.suites);
    expect(tests[0].status).toBe('todo');
    expect(result.totals.todo).toBe(1);
  });

  it('totals invariant holds when all four statuses coexist', async () => {
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest('passing', () => {});
        argusTest('failing', () => {
          throw new Error('fail');
        });
        argusTest.skip('skipped', () => {});
        argusTest.todo('todo');
      });
    });

    expect(result.totals.passed).toBe(1);
    expect(result.totals.failed).toBe(1);
    expect(result.totals.skipped).toBe(1);
    expect(result.totals.todo).toBe(1);
    expect(result.totals.total).toBe(4);
    expect(
      result.totals.passed + result.totals.failed + result.totals.skipped + result.totals.todo,
    ).toBe(result.totals.total);
  });

  it('test.todo(name, fn) ignores the body — never executed', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('suite', () => {
        argusTest.todo('with body', () => {
          log.push('body-ran');
        });
      });
    });

    expect(log).not.toContain('body-ran');
    expect(flattenTests(result.suites)[0].status).toBe('todo');
  });

  it('a todo-only suite does NOT run beforeAll/afterAll', async () => {
    const log: string[] = [];
    const result = await runWith(() => {
      argusDescribe('todo-only', () => {
        argusBeforeAll(() => {
          log.push('BA');
        });
        argusAfterAll(() => {
          log.push('AA');
        });
        argusTest.todo('pending one');
        argusTest.todo('pending two');
      });
    });

    expect(log).toEqual([]); // neither hook ran
    const tests = flattenTests(result.suites);
    expect(tests.every((t) => t.status === 'todo')).toBe(true);
    expect(result.totals.todo).toBe(2);
  });

  it('an outer beforeAll does NOT run when the only nested suite is todo-only', async () => {
    const log: string[] = [];
    await runWith(() => {
      argusDescribe('outer', () => {
        argusBeforeAll(() => {
          log.push('outer-BA');
        });
        argusDescribe('inner', () => {
          argusTest.todo('pending');
        });
      });
    });

    expect(log).toEqual([]); // outer beforeAll must not fire for a todo-only subtree
  });

  it('beforeAll DOES run when an executable test sits beside a todo', async () => {
    const log: string[] = [];
    await runWith(() => {
      argusDescribe('mixed', () => {
        argusBeforeAll(() => {
          log.push('BA');
        });
        argusTest.todo('pending');
        argusTest('real', () => {});
      });
    });

    expect(log).toEqual(['BA']); // the executable test triggers beforeAll exactly once
  });
});

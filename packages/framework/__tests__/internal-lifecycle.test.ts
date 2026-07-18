import { expect, it, describe as vDescribe } from 'vitest';
import {
  afterEach,
  beforeEach,
  describe,
  flattenTests,
  registerInternalAfterEach,
  runWith,
  test,
} from './run-harness.js';

vDescribe('internal afterEach lifecycle', () => {
  it('runs after nested user afterEach hooks in inner-to-outer order', async () => {
    const events: string[] = [];
    const unregister = registerInternalAfterEach(() => events.push('internal'));
    try {
      await runWith(() => {
        describe('outer', () => {
          afterEach(() => events.push('outer'));
          describe('inner', () => {
            afterEach(() => events.push('inner'));
            test('case', () => events.push('test'));
          });
        });
      });
    } finally {
      unregister();
    }

    expect(events).toEqual(['test', 'inner', 'outer', 'internal']);
  });

  it('runs after setup, test-body, and user-cleanup failures', async () => {
    const events: string[] = [];
    const unregister = registerInternalAfterEach(() => events.push('internal'));
    try {
      const beforeResult = await runWith(() => {
        describe('before failure', () => {
          beforeEach(() => {
            throw new Error('setup failed');
          });
          afterEach(() => events.push('user cleanup'));
          test('case', () => events.push('body'));
        });
      });
      expect(flattenTests(beforeResult.suites)[0].status).toBe('failed');

      const bodyResult = await runWith(() => {
        describe('body failure', () => {
          afterEach(() => {
            events.push('failing cleanup');
            throw new Error('cleanup failed');
          });
          test('case', () => {
            throw new Error('body failed');
          });
        });
      });
      expect(flattenTests(bodyResult.suites)[0].failureMessage).toContain('body failed');
    } finally {
      unregister();
    }

    expect(events).toEqual(['user cleanup', 'internal', 'failing cleanup', 'internal']);
  });

  it('does not run for skipped or todo tests', async () => {
    let calls = 0;
    const unregister = registerInternalAfterEach(() => calls++);
    try {
      await runWith(() => {
        describe('inactive', () => {
          test.skip('skipped', () => undefined);
          test.todo('todo');
        });
      });
    } finally {
      unregister();
    }

    expect(calls).toBe(0);
  });
});

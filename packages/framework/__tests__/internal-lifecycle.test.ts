import React from 'react';
import { expect, it, describe as vDescribe } from 'vitest';
import { cleanupActiveRenders, render, screen } from '../src/component/render.js';
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

  it('cleans active component roots after a failed test', async () => {
    const unregister = registerInternalAfterEach(cleanupActiveRenders);
    try {
      const result = await runWith(() => {
        describe('component failure', () => {
          test('case', () => {
            render(React.createElement('Text', null, 'leaked'));
            throw new Error('failed after render');
          });
        });
      });

      expect(flattenTests(result.suites)[0].status).toBe('failed');
      expect(() => screen.root).toThrow('No active component render');
    } finally {
      unregister();
    }
  });
});

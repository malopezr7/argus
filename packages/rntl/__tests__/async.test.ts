import React from 'react';
import { describe, expect, it } from 'vitest';
import { runInternalAfterEach } from '../../framework/src/lifecycle.js';
import { render, screen, waitFor, waitForElementToBeRemoved, within } from '../src/index.js';

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected promise to reject');
}

describe('component async utilities', () => {
  it('returns any non-throwing callback result, including a falsy one', async () => {
    let attempts = 0;

    const result = await waitFor(() => {
      attempts++;
      return 0;
    });

    expect(result).toBe(0);
    expect(attempts).toBe(1);
  });

  it('allows an immediate successful attempt with a zero timeout', async () => {
    await expect(waitFor(() => 'ready', { timeout: 0 })).resolves.toBe('ready');
  });

  it('reports wall-clock exhaustion and preserves the last callback error', async () => {
    const error = await rejectionOf(
      waitFor(
        () => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < 10) {
            // Cross the captured real deadline before reporting the last error.
          }
          throw new Error('condition is still false');
        },
        { timeout: 5, interval: 1 },
      ),
    );

    expect(error.message).toContain('condition is still false');
    expect(error.message).toContain('wall-clock budget');
    expect(error.message).toContain('timeout: 5 ms');
    expect(error.message).toContain('interval: 1 ms');
  });

  it('bounds a callback promise that never settles', async () => {
    const error = await rejectionOf(
      waitFor(() => new Promise<never>(() => undefined), { timeout: 20, interval: 5 }),
    );

    expect(error.message).toContain('wall-clock budget');
    expect(error.message).toContain('1 callback attempt(s)');
  });

  it('flushes a promise-backed state update before retrying a query', async () => {
    function PromiseStatus(): React.ReactElement {
      const [status, setStatus] = React.useState('pending');
      React.useEffect(() => {
        Promise.resolve().then(() => setStatus('ready'));
      }, []);
      return React.createElement('Text', null, status);
    }

    const result = render(React.createElement(PromiseStatus));
    try {
      const ready = await screen.findByText('ready');
      expect(ready.type).toBe('Text');
    } finally {
      result.unmount();
    }
  });

  it('flushes chained timers and exposes async queries on render results', async () => {
    function TimerStatus(): React.ReactElement {
      const [status, setStatus] = React.useState('pending');
      React.useEffect(() => {
        setTimeout(() => {
          setTimeout(() => setStatus('ready'), 1);
        }, 1);
      }, []);
      return React.createElement('Text', null, status);
    }

    const result = render(React.createElement(TimerStatus));
    try {
      const ready = await result.findByText('ready', { timeout: 200, interval: 5 });
      expect(ready.type).toBe('Text');
    } finally {
      result.unmount();
    }
  });

  it('serializes concurrent queries through one async act scheduler', async () => {
    function ConcurrentStatus(): React.ReactElement {
      const [first, setFirst] = React.useState('first pending');
      const [second, setSecond] = React.useState('second pending');
      React.useEffect(() => {
        setTimeout(() => setFirst('first ready'), 1);
        setTimeout(() => setSecond('second ready'), 1);
      }, []);
      return React.createElement(
        'View',
        null,
        React.createElement('Text', null, first),
        React.createElement('Text', null, second),
      );
    }

    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      diagnostics[diagnostics.length] = args.join(' ');
    };

    const result = render(React.createElement(ConcurrentStatus));
    try {
      const [first, second] = await Promise.all([
        screen.findByText('first ready'),
        screen.findByText('second ready'),
      ]);

      expect(first.type).toBe('Text');
      expect(second.type).toBe('Text');
      expect(diagnostics.join('\n')).not.toContain('overlapping act() calls');
    } finally {
      console.error = originalError;
      result.unmount();
    }
  });

  it('allows a wait inside another wait callback without overlapping act scopes', async () => {
    let innerAttempts = 0;
    const diagnostics: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      diagnostics[diagnostics.length] = args.join(' ');
    };

    try {
      const value = await waitFor(
        async () =>
          waitFor(
            () => {
              innerAttempts++;
              if (innerAttempts === 1) throw new Error('inner pending');
              return 'nested ready';
            },
            { timeout: 100, interval: 5 },
          ),
        { timeout: 100, interval: 5 },
      );

      expect(value).toBe('nested ready');
      expect(diagnostics.join('\n')).not.toContain('overlapping act() calls');
    } finally {
      console.error = originalError;
    }
  });

  it('cancels and drains an abandoned wait at the test boundary', async () => {
    render(React.createElement('Text', null, 'first test'));
    void screen.findByText('never appears', { timeout: 100, interval: 10 });

    expect(await runInternalAfterEach()).toBeUndefined();

    const next = render(React.createElement('Text', null, 'second test'));
    try {
      expect(screen.getByText('second test').type).toBe('Text');
    } finally {
      next.unmount();
    }
  });

  it('rejects a synchronous result produced after the wall-clock deadline', async () => {
    const error = await rejectionOf(
      waitFor(
        () => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < 20) {
            // Deliberately cross the real deadline inside the callback.
          }
          return 'late';
        },
        { timeout: 5, interval: 1 },
      ),
    );

    expect(error.message).toContain('wall-clock budget');
  });

  it('rejects a promise result produced after the wall-clock deadline', async () => {
    const error = await rejectionOf(
      waitFor(
        () =>
          Promise.resolve().then(() => {
            const startedAt = Date.now();
            while (Date.now() - startedAt < 20) {
              // Deliberately cross the real deadline in a microtask.
            }
            return 'late';
          }),
        { timeout: 5, interval: 1 },
      ),
    );

    expect(error.message).toContain('wall-clock budget');
  });

  it('supports findBy and findAllBy for every query predicate', async () => {
    const result = render(
      React.createElement(
        'View',
        { testID: 'scope' },
        React.createElement('Text', { accessibilityRole: 'header', testID: 'title' }, 'Title'),
        React.createElement('TextInput', { placeholder: 'Email', value: 'user@example.com' }),
      ),
    );

    try {
      expect((await screen.findByText('Title')).props.testID).toBe('title');
      expect(await screen.findAllByText('Title')).toHaveLength(1);
      expect((await screen.findByTestId('title')).type).toBe('Text');
      expect(await screen.findAllByTestId('title')).toHaveLength(1);
      expect((await screen.findByRole('header')).type).toBe('Text');
      expect(await screen.findAllByRole('header')).toHaveLength(1);
      expect((await screen.findByPlaceholderText('Email')).type).toBe('TextInput');
      expect(await screen.findAllByPlaceholderText('Email')).toHaveLength(1);
      expect((await screen.findByDisplayValue('user@example.com')).type).toBe('TextInput');
      expect(await screen.findAllByDisplayValue('user@example.com')).toHaveLength(1);
      expect((await within(screen.getByTestId('scope')).findByText('Title')).type).toBe('Text');
    } finally {
      result.unmount();
    }
  });

  it('keeps synchronous missing and multiple-match diagnostics in findBy failures', async () => {
    const result = render(
      React.createElement(
        'View',
        null,
        React.createElement('Text', null, 'duplicate'),
        React.createElement('Text', null, 'duplicate'),
      ),
    );

    try {
      const missing = await rejectionOf(screen.findByText('missing', { timeout: 0 }));
      const multiple = await rejectionOf(screen.findByText('duplicate', { timeout: 0 }));

      expect(missing.message).toContain('No elements found for text');
      expect(missing.stack).toContain('singular');
      expect(multiple.message).toContain('Multiple elements found for text');
      expect(multiple.stack).toContain('singular');
    } finally {
      result.unmount();
    }
  });

  it('waits for an element returned by a callback to be removed', async () => {
    function VanishingStatus(): React.ReactElement | null {
      const [visible, setVisible] = React.useState(true);
      React.useEffect(() => {
        Promise.resolve().then(() => setVisible(false));
      }, []);
      return visible ? React.createElement('Text', null, 'loading') : null;
    }

    const result = render(React.createElement(VanishingStatus));
    try {
      const initial = screen.getByText('loading');
      const removed = await waitForElementToBeRemoved(() => screen.getByText('loading'));

      expect(removed).toBe(initial);
      expect(screen.queryByText('loading')).toBeNull();
    } finally {
      result.unmount();
    }
  });

  it('accepts a held live element and rejects one already detached', async () => {
    function VanishingStatus(): React.ReactElement | null {
      const [visible, setVisible] = React.useState(true);
      React.useEffect(() => {
        setTimeout(() => setVisible(false), 1);
      }, []);
      return visible ? React.createElement('Text', null, 'held') : null;
    }

    const result = render(React.createElement(VanishingStatus));
    const held = screen.getByText('held');
    try {
      await expect(waitForElementToBeRemoved(held)).resolves.toBe(held);
      await expect(waitForElementToBeRemoved(held)).rejects.toThrow('already removed');
    } finally {
      result.unmount();
    }
  });

  it('uses its captured scheduler when a test replaces global setTimeout', async () => {
    const host = globalThis as typeof globalThis & { setTimeout: typeof setTimeout };
    const originalSetTimeout = host.setTimeout;
    let attempts = 0;
    host.setTimeout = function blockedTimer(): never {
      throw new Error('the fake test timer must not drive waitFor');
    } as typeof setTimeout;

    try {
      await expect(
        waitFor(
          () => {
            attempts++;
            if (attempts === 1) throw new Error('not ready');
            return 'ready';
          },
          { timeout: 100, interval: 1 },
        ),
      ).resolves.toBe('ready');
    } finally {
      host.setTimeout = originalSetTimeout;
    }
  });

  it('keeps its wall-clock budget independent from a replaced Date.now', async () => {
    const originalDateNow = Date.now;
    let fakeNow = 0;
    let attempts = 0;
    Date.now = (): number => fakeNow;

    try {
      await expect(
        waitFor(
          () => {
            attempts++;
            if (attempts === 1) {
              fakeNow = 1_000_000;
              throw new Error('not ready');
            }
            return 'ready';
          },
          { timeout: 100, interval: 1 },
        ),
      ).resolves.toBe('ready');
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('keeps findBy queries and MessageChannel on the captured scheduler', async () => {
    const host = globalThis as typeof globalThis & { setTimeout: typeof setTimeout };
    const originalSetTimeout = host.setTimeout;
    const result = render(React.createElement('Text', null, 'pending'));
    host.setTimeout = function blockedTimer(): never {
      throw new Error('the fake test timer must not drive findBy');
    } as typeof setTimeout;

    try {
      Promise.resolve().then(() => result.rerender(React.createElement('Text', null, 'ready')));
      await expect(
        screen.findByText('ready', { timeout: 100, interval: 1 }),
      ).resolves.toMatchObject({
        type: 'Text',
      });
    } finally {
      host.setTimeout = originalSetTimeout;
      result.unmount();
    }
  });
});

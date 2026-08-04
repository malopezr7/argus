import React from 'react';
import { describe, expect, it, vi } from 'vitest';
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

  it('reports wall-clock exhaustion and preserves the last callback error', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(110);

    try {
      const error = await rejectionOf(
        waitFor(
          () => {
            throw new Error('condition is still false');
          },
          { timeout: 5, interval: 1 },
        ),
      );

      expect(error.message).toContain('condition is still false');
      expect(error.message).toContain('wall-clock budget');
      expect(error.message).toContain('timeout: 5 ms');
      expect(error.message).toContain('interval: 1 ms');
    } finally {
      now.mockRestore();
    }
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
});

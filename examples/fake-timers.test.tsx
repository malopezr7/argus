import './fake-timers-setup.js';
import { act, fireEvent, render, screen, userEvent, waitFor } from 'argus';
import React from 'react';
import { Pressable, Text } from 'react-native';

declare const afterEach: (fn: () => void) => void;
declare const argus: {
  useFakeTimers(config?: { now?: number | Date; timerLimit?: number }): typeof argus;
  useRealTimers(): typeof argus;
  advanceTimersByTime(ms: number): typeof argus;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  runAllTimers(): typeof argus;
  runOnlyPendingTimers(): typeof argus;
  clearAllTimers(): typeof argus;
  getTimerCount(): number;
  setSystemTime(now?: number | Date): typeof argus;
  getRealSystemTime(): number;
};

describe('fake timers on standalone Hermes', () => {
  afterEach(() => {
    argus.useRealTimers();
  });

  test('waitFor survives fake timers installed before the component module', async () => {
    let attempts = 0;
    const value = await waitFor(
      () => {
        attempts++;
        if (attempts === 1) throw new Error('not ready');
        return 'ready';
      },
      { timeout: 100, interval: 1 },
    );

    expect(value).toBe('ready');
  });

  test('a debounce stays pending until its delay has elapsed', () => {
    function DebouncedStatus(): React.ReactElement {
      const [status, setStatus] = React.useState('idle');
      return (
        <Pressable onPress={() => setTimeout(() => setStatus('fired'), 300)}>
          <Text>{status}</Text>
        </Pressable>
      );
    }

    argus.useFakeTimers({ now: 1000 });
    render(<DebouncedStatus />);
    fireEvent.press(screen.getByText('idle'));

    expect(screen.getByText('idle').type).toBe('Text');
    act(() => argus.advanceTimersByTime(299));
    expect(screen.getByText('idle').type).toBe('Text');
    act(() => argus.advanceTimersByTime(1));
    expect(screen.getByText('fired').type).toBe('Text');
  });

  test('waitFor uses its real scheduler and deadline while system time is fake', async () => {
    argus.useFakeTimers({ now: 10_000 });
    let attempts = 0;

    const value = await waitFor(
      () => {
        attempts++;
        if (attempts === 1) {
          argus.setSystemTime(9_000_000);
          throw new Error('not ready');
        }
        return 'ready';
      },
      { timeout: 100, interval: 1 },
    );

    expect(value).toBe('ready');
    expect(attempts).toBe(2);
  });

  test('runs pending and recursively scheduled timers with fake intervals', () => {
    argus.useFakeTimers({ now: 0 });
    const calls: string[] = [];
    setTimeout(() => {
      calls.push('outer');
      setTimeout(() => calls.push('nested'), 0);
    }, 10);
    const intervalHandle = setInterval(() => {
      calls.push('interval');
      clearInterval(intervalHandle);
    }, 20);

    argus.runOnlyPendingTimers();
    expect(calls.join(',')).toBe('outer,nested,interval');
    expect(argus.getTimerCount()).toBe(0);
  });

  test('controls Date independently from pending timer delays', () => {
    argus.useFakeTimers({ now: 100 });
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 50);

    argus.setSystemTime(10_000);
    expect(Date.now()).toBe(10_000);
    argus.advanceTimersByTime(49);
    expect(fired).toBe(false);
    argus.advanceTimersByTime(1);
    expect(fired).toBe(true);
    expect(argus.getRealSystemTime()).toBeGreaterThan(0);

    argus.clearAllTimers();
    expect(Date.now()).toBe(100);
  });

  test('settles promise callbacks between timers during async advancement', async () => {
    argus.useFakeTimers({ now: 0 });
    const calls: string[] = [];
    setTimeout(() => {
      calls.push('first');
      Promise.resolve()
        .then(() => calls.push('p1'))
        .then(() => calls.push('p2'))
        .then(() => calls.push('p3'));
    }, 0);
    setTimeout(() => calls.push('second'), 0);

    await argus.advanceTimersByTimeAsync(0);
    expect(calls.join(',')).toBe('first,p1,p2,p3,second');
  });

  test('leaves a zero-delay self-reschedule pending after advancing zero milliseconds', () => {
    argus.useFakeTimers({ now: 0, timerLimit: 3 });
    let calls = 0;
    function again(): void {
      calls++;
      setTimeout(again, 0);
    }
    setTimeout(again, 0);

    argus.advanceTimersByTime(0);

    expect(calls).toBe(1);
    expect(argus.getTimerCount()).toBe(1);
    expect(Date.now()).toBe(0);
  });

  test('preserves system time changed from a promise during async advancement', async () => {
    argus.useFakeTimers({ now: 0 });
    let firedAt = '';
    setTimeout(() => {
      Promise.resolve().then(() => argus.setSystemTime(1000));
    }, 10);
    setTimeout(() => {
      firedAt = String(Date.now());
    }, 20);

    await argus.advanceTimersByTimeAsync(20);

    expect(`${firedAt} | ${Date.now()} | ${argus.getTimerCount()}`).toBe('1010 | 1010 | 0');
  });

  test('does not reuse handles after reinstalling fake timers', () => {
    argus.useFakeTimers({ now: 0 });
    const staleHandle = setTimeout(() => undefined, 1);
    argus.useFakeTimers({ now: 0 });
    let calls = 0;
    const freshHandle = setTimeout(() => calls++, 1);

    expect(freshHandle).not.toBe(staleHandle);
    clearTimeout(staleHandle);
    argus.runAllTimers();

    expect(calls).toBe(1);
  });

  test('findBy keeps React async act on the real scheduler', async () => {
    argus.useFakeTimers();
    const result = render(<Text>pending</Text>);
    Promise.resolve().then(() => result.rerender(<Text>ready</Text>));

    expect((await screen.findByText('ready')).type).toBe('Text');
  });

  test('userEvent advances fake timers through its setup hook', async () => {
    function PressStatus(): React.ReactElement {
      const [status, setStatus] = React.useState('idle');
      return (
        <Pressable onPress={() => setStatus('pressed')}>
          <Text>{status}</Text>
        </Pressable>
      );
    }

    argus.useFakeTimers();
    render(<PressStatus />);
    const user = userEvent.setup({ advanceTimers: argus.advanceTimersByTime });

    await user.press(screen.getByText('idle'));
    expect(screen.getByText('pressed').type).toBe('Text');
    expect(argus.getTimerCount()).toBe(0);
  });

  test('direct userEvent uses a real fallback while fake timers are active', async () => {
    function PressStatus(): React.ReactElement {
      const [status, setStatus] = React.useState('idle');
      return (
        <Pressable onPress={() => setStatus('pressed')}>
          <Text>{status}</Text>
        </Pressable>
      );
    }

    argus.useFakeTimers();
    render(<PressStatus />);

    await userEvent.press(screen.getByText('idle'));

    expect(screen.getByText('pressed').type).toBe('Text');
    expect(argus.getTimerCount()).toBe(0);
  });
});

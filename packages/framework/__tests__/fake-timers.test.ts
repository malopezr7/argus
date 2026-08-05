import { describe, expect, it } from 'vitest';
import { installArgusNamespace } from '../src/argus-namespace.js';

type TimerCallback = (...args: unknown[]) => void;
type Schedule = (callback: TimerCallback, delay?: number, ...args: unknown[]) => unknown;
type Cancel = (handle?: unknown) => void;

interface FakeTimersConfig {
  now?: number | Date;
  timerLimit?: number;
}

interface TimerArgus {
  useFakeTimers(config?: FakeTimersConfig): TimerArgus;
  useRealTimers(): TimerArgus;
  advanceTimersByTime(ms: number): TimerArgus;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  runAllTimers(): TimerArgus;
  runOnlyPendingTimers(): TimerArgus;
  clearAllTimers(): TimerArgus;
  getTimerCount(): number;
  setSystemTime(now?: number | Date): TimerArgus;
  getRealSystemTime(): number;
}

interface TimerRealm extends Record<string, unknown> {
  Date: DateConstructor;
  setTimeout: Schedule;
  clearTimeout: Cancel;
  setInterval?: Schedule;
  clearInterval?: Cancel;
}

function createRealm(includeIntervals = true): {
  argus: TimerArgus;
  realm: TimerRealm;
  warnings: string[];
} {
  const warnings: string[] = [];
  const realm: TimerRealm = {
    Date,
    setTimeout: globalThis.setTimeout as unknown as Schedule,
    clearTimeout: globalThis.clearTimeout as unknown as Cancel,
    console: {
      warn: (...args: unknown[]): void => {
        warnings[warnings.length] = args.join(' ');
      },
    },
  };
  if (includeIntervals) {
    realm.setInterval = globalThis.setInterval as unknown as Schedule;
    realm.clearInterval = globalThis.clearInterval as unknown as Cancel;
  }
  installArgusNamespace(realm);
  return { argus: realm.argus as TimerArgus, realm, warnings };
}

function timeout(realm: TimerRealm): Schedule {
  return realm.setTimeout;
}

function interval(realm: TimerRealm): Schedule {
  return realm.setInterval as Schedule;
}

function clearIntervalIn(realm: TimerRealm): Cancel {
  return realm.clearInterval as Cancel;
}

describe('Argus fake timers', () => {
  it('keeps a debounce pending until fake time reaches its delay', () => {
    const { argus, realm } = createRealm();
    let fired = false;

    expect(argus.useFakeTimers({ now: 1000 })).toBe(argus);
    timeout(realm)(() => {
      fired = true;
    }, 300);

    expect(fired).toBe(false);
    expect(argus.getTimerCount()).toBe(1);
    argus.advanceTimersByTime(299);
    expect(fired).toBe(false);
    expect(realm.Date.now()).toBe(1299);

    expect(argus.advanceTimersByTime(1)).toBe(argus);
    expect(fired).toBe(true);
    expect(realm.Date.now()).toBe(1300);
    expect(argus.getTimerCount()).toBe(0);
  });

  it('runs timeouts by due time, then registration order, with callback arguments', () => {
    const { argus, realm } = createRealm();
    const calls: string[] = [];
    argus.useFakeTimers({ now: 0 });

    timeout(realm)((value) => calls.push(String(value)), 50, 't50');
    timeout(realm)(() => {
      calls.push('t0');
      timeout(realm)(() => calls.push('nested'), 0);
    }, 0);
    timeout(realm)(() => calls.push('t10'), 10);

    argus.advanceTimersByTime(10);
    expect(calls).toEqual(['t0', 'nested', 't10']);
    argus.advanceTimersByTime(40);
    expect(calls).toEqual(['t0', 'nested', 't10', 't50']);
  });

  it('repeats intervals until they are cleared', () => {
    const { argus, realm } = createRealm();
    argus.useFakeTimers({ now: 0 });
    let calls = 0;
    let handle: unknown;

    handle = interval(realm)(() => {
      calls++;
      if (calls === 3) clearIntervalIn(realm)(handle);
    }, 10);

    argus.advanceTimersByTime(100);
    expect(calls).toBe(3);
    expect(argus.getTimerCount()).toBe(0);
  });

  it('leaves newly scheduled timers beyond the original pending horizon', () => {
    const { argus, realm } = createRealm();
    const calls: string[] = [];
    argus.useFakeTimers({ now: 0 });

    timeout(realm)(() => {
      calls.push('outer');
      timeout(realm)(() => calls.push('same-time'), 0);
      timeout(realm)(() => calls.push('later'), 1);
    }, 10);

    expect(argus.runOnlyPendingTimers()).toBe(argus);
    expect(calls).toEqual(['outer']);
    expect(realm.Date.now()).toBe(10);
    expect(argus.getTimerCount()).toBe(2);
  });

  it('runs timers newly scheduled inside the original pending horizon', () => {
    const { argus, realm } = createRealm();
    const calls: string[] = [];
    argus.useFakeTimers({ now: 0 });
    timeout(realm)(() => {
      calls.push('outer');
      timeout(realm)(() => calls.push('nested'), 0);
    }, 10);
    const intervalHandle = interval(realm)(() => {
      calls.push('interval');
      clearIntervalIn(realm)(intervalHandle);
    }, 20);

    argus.runOnlyPendingTimers();

    expect(calls).toEqual(['outer', 'nested', 'interval']);
    expect(realm.Date.now()).toBe(20);
    expect(argus.getTimerCount()).toBe(0);
  });

  it('runs recursively scheduled timers and stops infinite recursion at timerLimit', () => {
    const finite = createRealm();
    const calls: number[] = [];
    finite.argus.useFakeTimers({ now: 0 });

    function schedule(value: number): void {
      timeout(finite.realm)(() => {
        calls.push(value);
        if (value < 3) schedule(value + 1);
      }, 10);
    }
    schedule(1);

    expect(finite.argus.runAllTimers()).toBe(finite.argus);
    expect(calls).toEqual([1, 2, 3]);
    expect(finite.realm.Date.now()).toBe(30);

    const infinite = createRealm();
    infinite.argus.useFakeTimers({ timerLimit: 3 });
    function forever(): void {
      timeout(infinite.realm)(forever, 0);
    }
    forever();

    expect(() => infinite.argus.runAllTimers()).toThrow('Aborting after running 3 timers');
  });

  it('clears timers and resets the fake clock to its installation time', () => {
    const { argus, realm } = createRealm();
    argus.useFakeTimers({ now: 1000 });
    timeout(realm)(() => undefined, 100);
    argus.advanceTimersByTime(25);
    expect(realm.Date.now()).toBe(1025);

    expect(argus.clearAllTimers()).toBe(argus);
    expect(realm.Date.now()).toBe(1000);
    expect(argus.getTimerCount()).toBe(0);
  });

  it('changes system time without changing a timer remaining delay', () => {
    const { argus, realm } = createRealm();
    const calls: string[] = [];
    const beforeReal = Date.now();
    argus.useFakeTimers({ now: 9000 });
    timeout(realm)(() => calls.push('timer'), 50);

    expect(argus.setSystemTime(20_000)).toBe(argus);
    expect(realm.Date.now()).toBe(20_000);
    argus.advanceTimersByTime(49);
    expect(calls).toEqual([]);
    argus.advanceTimersByTime(1);
    expect(calls).toEqual(['timer']);

    argus.setSystemTime();
    expect(realm.Date.now()).toBe(0);
    expect(argus.getRealSystemTime()).toBeGreaterThanOrEqual(beforeReal);
    expect(argus.getRealSystemTime()).toBeLessThanOrEqual(Date.now());
  });

  it('fakes Date construction and calls while preserving explicit dates and statics', () => {
    const { argus, realm } = createRealm();
    argus.useFakeTimers({ now: 1234 });
    const FakeDate = realm.Date;

    expect(FakeDate.now()).toBe(1234);
    expect(new FakeDate().getTime()).toBe(1234);
    expect(new FakeDate(99).getTime()).toBe(99);
    expect(FakeDate()).toBe(new Date(1234).toString());
    expect(FakeDate.parse('1970-01-01T00:00:00.000Z')).toBe(0);
    expect(FakeDate.UTC(1970, 0, 1)).toBe(0);
    expect(new FakeDate() instanceof FakeDate).toBe(true);
  });

  it('lets promise callbacks settle between timers in the async advance variant', async () => {
    const { argus, realm } = createRealm();
    const calls: string[] = [];
    argus.useFakeTimers({ now: 0 });

    timeout(realm)(() => {
      calls.push('first');
      Promise.resolve()
        .then(() => calls.push('p1'))
        .then(() => calls.push('p2'))
        .then(() => calls.push('p3'));
    }, 0);
    timeout(realm)(() => calls.push('second'), 0);

    await argus.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['first', 'p1', 'p2', 'p3', 'second']);
  });

  it('leaves a zero-delay self-reschedule pending after advancing zero milliseconds', () => {
    const { argus, realm } = createRealm();
    argus.useFakeTimers({ now: 0, timerLimit: 3 });
    let calls = 0;
    function again(): void {
      calls++;
      timeout(realm)(again, 0);
    }
    timeout(realm)(again, 0);

    expect(() => argus.advanceTimersByTime(0)).not.toThrow();
    expect(calls).toBe(1);
    expect(argus.getTimerCount()).toBe(1);
    expect(realm.Date.now()).toBe(0);
  });

  it('preserves system time changed from a promise callback during async advancement', async () => {
    const { argus, realm } = createRealm();
    argus.useFakeTimers({ now: 0 });
    let firedAt = '';
    timeout(realm)(() => {
      Promise.resolve().then(() => argus.setSystemTime(1000));
    }, 10);
    timeout(realm)(() => {
      firedAt = String(realm.Date.now());
    }, 20);

    await argus.advanceTimersByTimeAsync(20);

    expect(`${firedAt} | ${realm.Date.now()} | ${argus.getTimerCount()}`).toBe('1010 | 1010 | 0');
  });

  it('reinstalling resets state and useRealTimers restores the captured globals', () => {
    const { argus, realm } = createRealm();
    const originalDate = realm.Date;
    const originalSetTimeout = realm.setTimeout;
    const originalSetInterval = realm.setInterval;

    argus.useFakeTimers({ now: 10 });
    timeout(realm)(() => undefined, 10);
    argus.useFakeTimers({ now: 20 });
    expect(realm.Date.now()).toBe(20);
    expect(argus.getTimerCount()).toBe(0);

    expect(argus.useRealTimers()).toBe(argus);
    expect(realm.Date).toBe(originalDate);
    expect(realm.setTimeout).toBe(originalSetTimeout);
    expect(realm.setInterval).toBe(originalSetInterval);
  });

  it('does not reuse timer handles after reinstalling fake timers', () => {
    const { argus, realm } = createRealm();
    argus.useFakeTimers({ now: 0 });
    const staleHandle = timeout(realm)(() => undefined, 1);
    argus.useFakeTimers({ now: 0 });
    let calls = 0;
    const freshHandle = timeout(realm)(() => calls++, 1);

    expect(freshHandle).not.toBe(staleHandle);
    realm.clearTimeout(staleHandle);
    argus.runAllTimers();

    expect(calls).toBe(1);
    expect(argus.getTimerCount()).toBe(0);
  });

  it('stops draining an abandoned fake clock when a callback restores real timers', () => {
    const { argus, realm } = createRealm();
    const calls: string[] = [];
    const originalDate = realm.Date;
    argus.useFakeTimers({ now: 0 });
    timeout(realm)(() => {
      calls.push('first');
      argus.useRealTimers();
    }, 0);
    timeout(realm)(() => calls.push('stale'), 1);

    argus.runAllTimers();

    expect(calls).toEqual(['first']);
    expect(realm.Date).toBe(originalDate);
  });

  it('supplies fake intervals in Hermes and removes them when real timers return', () => {
    const { argus, realm } = createRealm(false);
    expect(realm.setInterval).toBeUndefined();
    expect(realm.clearInterval).toBeUndefined();

    argus.useFakeTimers();
    expect(typeof realm.setInterval).toBe('function');
    expect(typeof realm.clearInterval).toBe('function');

    argus.useRealTimers();
    expect(realm.setInterval).toBeUndefined();
    expect(realm.clearInterval).toBeUndefined();
  });

  it('matches Jest no-op behavior before fake timers are installed', () => {
    const { argus, warnings } = createRealm();

    expect(argus.getTimerCount()).toBe(0);
    expect(argus.advanceTimersByTime(10)).toBe(argus);
    expect(argus.runAllTimers()).toBe(argus);
    expect(argus.runOnlyPendingTimers()).toBe(argus);
    expect(argus.setSystemTime(100)).toBe(argus);
    expect(argus.clearAllTimers()).toBe(argus);
    expect(argus.useRealTimers()).toBe(argus);
    expect(warnings.length).toBe(5);
    expect(warnings[0]).toContain('Call `argus.useFakeTimers()`');
  });
});

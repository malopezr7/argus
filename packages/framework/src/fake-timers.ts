type TimerCallback = (...args: unknown[]) => void;
type TimerKind = 'timeout' | 'interval';

// Framework primordials: this module is evaluated through argus-namespace before
// any user dependency. Component schedulers import these same captured values.
export const capturedDateNow = Date.now;
export const capturedSetTimeout = setTimeout;

interface HermesInternalLike {
  useEngineQueue?(): boolean;
}

const capturedHermesInternal = (globalThis as Record<string, unknown>).HermesInternal as
  | HermesInternalLike
  | undefined;
// Legacy's Promise polyfill exposes no queue-drain primitive and may advance only
// one chained callback per native timer turn. Keep that bridge explicit and bounded.
const LEGACY_PROMISE_SETTLE_TURNS = 100;
const PROMISE_SETTLE_TURNS =
  capturedHermesInternal?.useEngineQueue?.() === false ? LEGACY_PROMISE_SETTLE_TURNS : 1;

interface TimerEntry {
  id: number;
  kind: TimerKind;
  callback: TimerCallback;
  args: unknown[];
  callAt: number;
  interval: number;
}

interface ClockState {
  now: number;
  installedAt: number;
  timerLimit: number;
  adjustedBy: number;
  executingTimer: boolean;
  timers: TimerEntry[];
}

export interface FakeTimersConfig {
  /** Initial fake epoch. Defaults to the real `Date.now()` at installation. */
  now?: number | Date;
  /** Maximum callbacks one drain operation may run. Defaults to Jest's 100,000. */
  timerLimit?: number;
}

export interface FakeTimersController {
  useFakeTimers(config?: FakeTimersConfig): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  runAllTimers(): void;
  runOnlyPendingTimers(): void;
  clearAllTimers(): void;
  getTimerCount(): number;
  setSystemTime(now?: number | Date): void;
  getRealSystemTime(): number;
}

interface CapturedGlobal {
  existed: boolean;
  value: unknown;
}

const DEFAULT_TIMER_LIMIT = 100_000;

function captured(g: Record<string, unknown>, name: string): CapturedGlobal {
  return { existed: Object.getOwnPropertyDescriptor(g, name) !== undefined, value: g[name] };
}

function restore(g: Record<string, unknown>, name: string, original: CapturedGlobal): void {
  if (original.existed) g[name] = original.value;
  else delete g[name];
}

function finiteTime(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function epoch(value: number | Date | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const result = typeof value === 'number' ? value : value.getTime();
  return finiteTime(result, 'Fake timer time');
}

function timerLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMER_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Fake timer timerLimit must be a positive safe integer');
  }
  return value;
}

function delayOf(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function constructDate(RealDate: DateConstructor, args: unknown[], now: number): Date {
  if (args.length === 0) return new RealDate(now);
  if (args.length === 1) return new RealDate(args[0] as string | number);
  const year = args[0] as number;
  const month = args[1] as number;
  if (args.length === 2) return new RealDate(year, month);
  const date = args[2] as number;
  if (args.length === 3) return new RealDate(year, month, date);
  const hours = args[3] as number;
  if (args.length === 4) return new RealDate(year, month, date, hours);
  const minutes = args[4] as number;
  if (args.length === 5) return new RealDate(year, month, date, hours, minutes);
  const seconds = args[5] as number;
  if (args.length === 6) return new RealDate(year, month, date, hours, minutes, seconds);
  return new RealDate(year, month, date, hours, minutes, seconds, args[6] as number);
}

function fakeDate(RealDate: DateConstructor, state: ClockState): DateConstructor {
  function FakeDate(this: unknown, ...args: unknown[]): Date | string {
    if (!(this instanceof FakeDate)) return new RealDate(state.now).toString();
    return constructDate(RealDate, args, state.now);
  }

  FakeDate.prototype = RealDate.prototype;
  const result = FakeDate as unknown as DateConstructor;
  result.now = function now(): number {
    return state.now;
  };
  result.parse = RealDate.parse;
  result.UTC = RealDate.UTC;
  return result;
}

function removeTimer(state: ClockState, id: number): void {
  for (let i = 0; i < state.timers.length; i++) {
    if (state.timers[i].id === id) {
      state.timers.splice(i, 1);
      return;
    }
  }
}

function nextTimer(
  state: ClockState,
  atOrBefore = Number.POSITIVE_INFINITY,
): TimerEntry | undefined {
  let next: TimerEntry | undefined;
  for (let i = 0; i < state.timers.length; i++) {
    const candidate = state.timers[i];
    if (candidate.callAt > atOrBefore) continue;
    if (
      next === undefined ||
      candidate.callAt < next.callAt ||
      (candidate.callAt === next.callAt && candidate.id < next.id)
    ) {
      next = candidate;
    }
  }
  return next;
}

function runTimer(state: ClockState, timer: TimerEntry): void {
  state.now = timer.callAt;
  if (timer.kind === 'interval') timer.callAt += timer.interval;
  else removeTimer(state, timer.id);
  const wasExecutingTimer = state.executingTimer;
  state.executingTimer = true;
  try {
    timer.callback.apply(undefined, timer.args);
  } finally {
    state.executingTimer = wasExecutingTimer;
  }
}

function limitError(limit: number): Error {
  return new Error(`Aborting after running ${limit} timers, assuming an infinite loop.`);
}

function validateAdvance(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new TypeError('Timer advance must be a finite number greater than or equal to 0');
  }
  return ms;
}

async function settlePromiseCallbacks(): Promise<void> {
  for (let turn = 0; turn < PROMISE_SETTLE_TURNS; turn++) {
    await new Promise<void>(function schedule(resolve): void {
      capturedSetTimeout(resolve, 0);
    });
  }
}

/** Create one fake clock bound to the supplied in-Hermes global object. */
export function createFakeTimers(g: Record<string, unknown>): FakeTimersController {
  const originals = {
    Date: captured(g, 'Date'),
    setTimeout: captured(g, 'setTimeout'),
    clearTimeout: captured(g, 'clearTimeout'),
    setInterval: captured(g, 'setInterval'),
    clearInterval: captured(g, 'clearInterval'),
  };
  const RealDate = (originals.Date.value ?? Date) as DateConstructor;
  const realDateNow = RealDate.now.bind(RealDate);
  let state: ClockState | undefined;
  let nextId = 1;

  function warn(method: string): void {
    const target = (g.console ?? globalThis.console) as { warn?: (...args: unknown[]) => void };
    target.warn?.(
      `${method} was called while timer APIs are not fake. ` +
        'Call `argus.useFakeTimers()` before controlling time.',
    );
  }

  function active(method: string): ClockState | undefined {
    if (state === undefined) warn(method);
    return state;
  }

  function schedule(kind: TimerKind, callback: unknown, delay: unknown, args: unknown[]): number {
    if (typeof callback !== 'function') {
      throw new TypeError(
        `${kind === 'timeout' ? 'setTimeout' : 'setInterval'} callback must be a function`,
      );
    }
    const clock = state;
    if (clock === undefined) throw new Error('Fake timer scheduling used before installation');
    const interval = delayOf(delay);
    const id = nextId++;
    clock.timers[clock.timers.length] = {
      id,
      kind,
      callback: callback as TimerCallback,
      args,
      callAt: clock.now + interval + (clock.executingTimer && interval === 0 ? 1 : 0),
      interval,
    };
    return id;
  }

  function install(config: FakeTimersConfig = {}): void {
    if (state !== undefined) uninstall();
    const now = epoch(config.now, realDateNow());
    state = {
      now,
      installedAt: now,
      timerLimit: timerLimit(config.timerLimit),
      adjustedBy: 0,
      executingTimer: false,
      timers: [],
    };
    const clock = state;
    g.Date = fakeDate(RealDate, clock);
    g.setTimeout = function setTimeoutFake(
      callback: unknown,
      delay?: unknown,
      ...args: unknown[]
    ): number {
      return schedule('timeout', callback, delay, args);
    };
    g.clearTimeout = function clearTimeoutFake(handle?: unknown): void {
      if (typeof handle === 'number') removeTimer(clock, handle);
    };
    g.setInterval = function setIntervalFake(
      callback: unknown,
      delay?: unknown,
      ...args: unknown[]
    ): number {
      return schedule('interval', callback, delay, args);
    };
    g.clearInterval = function clearIntervalFake(handle?: unknown): void {
      if (typeof handle === 'number') removeTimer(clock, handle);
    };
  }

  function uninstall(): void {
    if (state === undefined) return;
    state = undefined;
    restore(g, 'Date', originals.Date);
    restore(g, 'setTimeout', originals.setTimeout);
    restore(g, 'clearTimeout', originals.clearTimeout);
    restore(g, 'setInterval', originals.setInterval);
    restore(g, 'clearInterval', originals.clearInterval);
  }

  function advance(ms: number): void {
    const clock = active('argus.advanceTimersByTime()');
    if (clock === undefined) return;
    let target = clock.now + validateAdvance(ms);
    let runs = 0;
    let timer = nextTimer(clock, target);
    while (timer !== undefined) {
      if (runs >= clock.timerLimit) throw limitError(clock.timerLimit);
      const adjustedBefore = clock.adjustedBy;
      runTimer(clock, timer);
      if (state !== clock) return;
      target += clock.adjustedBy - adjustedBefore;
      runs++;
      timer = nextTimer(clock, target);
    }
    clock.now = target;
  }

  async function advanceAsync(ms: number): Promise<void> {
    const clock = active('argus.advanceTimersByTimeAsync()');
    if (clock === undefined) return;
    let target = clock.now + validateAdvance(ms);
    let runs = 0;
    await settlePromiseCallbacks();
    if (state !== clock) return;
    let timer = nextTimer(clock, target);
    while (timer !== undefined) {
      if (runs >= clock.timerLimit) throw limitError(clock.timerLimit);
      const adjustedBefore = clock.adjustedBy;
      runTimer(clock, timer);
      if (state !== clock) return;
      runs++;
      await settlePromiseCallbacks();
      if (state !== clock) return;
      target += clock.adjustedBy - adjustedBefore;
      timer = nextTimer(clock, target);
    }
    clock.now = target;
  }

  function runAll(): void {
    const clock = active('argus.runAllTimers()');
    if (clock === undefined) return;
    let runs = 0;
    let timer = nextTimer(clock);
    while (timer !== undefined) {
      if (runs >= clock.timerLimit) throw limitError(clock.timerLimit);
      runTimer(clock, timer);
      if (state !== clock) return;
      runs++;
      timer = nextTimer(clock);
    }
  }

  function runPending(): void {
    const clock = active('argus.runOnlyPendingTimers()');
    if (clock === undefined) return;
    let target = clock.now;
    for (let i = 0; i < clock.timers.length; i++) {
      if (clock.timers[i].callAt > target) target = clock.timers[i].callAt;
    }
    let runs = 0;
    let timer = nextTimer(clock, target);
    while (timer !== undefined) {
      if (runs >= clock.timerLimit) throw limitError(clock.timerLimit);
      const adjustedBefore = clock.adjustedBy;
      runTimer(clock, timer);
      if (state !== clock) return;
      target += clock.adjustedBy - adjustedBefore;
      runs++;
      timer = nextTimer(clock, target);
    }
    clock.now = target;
  }

  return {
    useFakeTimers: install,
    useRealTimers: uninstall,
    advanceTimersByTime: advance,
    advanceTimersByTimeAsync: advanceAsync,
    runAllTimers: runAll,
    runOnlyPendingTimers: runPending,
    clearAllTimers(): void {
      if (state === undefined) return;
      state.timers = [];
      state.now = state.installedAt;
      state.adjustedBy = 0;
    },
    getTimerCount(): number {
      const clock = active('argus.getTimerCount()');
      return clock?.timers.length ?? 0;
    },
    setSystemTime(now?: number | Date): void {
      const clock = active('argus.setSystemTime()');
      if (clock === undefined) return;
      const next = epoch(now, 0);
      const difference = next - clock.now;
      for (let i = 0; i < clock.timers.length; i++) clock.timers[i].callAt += difference;
      clock.now = next;
      clock.adjustedBy += difference;
    },
    getRealSystemTime: realDateNow,
  };
}

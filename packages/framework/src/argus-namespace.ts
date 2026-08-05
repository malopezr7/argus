import { createFakeTimers, type FakeTimersConfig } from './fake-timers.js';
import { argusFn, argusSpyOn } from './mock-fn.js';
import { mockNativeModule, resetNativeModules } from './native-mocks.js';

export interface ArgusNamespace {
  fn: typeof argusFn;
  spyOn: typeof argusSpyOn;
  mockNativeModule: typeof mockNativeModule;
  resetNativeModules: typeof resetNativeModules;
  useFakeTimers(config?: FakeTimersConfig): ArgusNamespace;
  useRealTimers(): ArgusNamespace;
  advanceTimersByTime(ms: number): ArgusNamespace;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  runAllTimers(): ArgusNamespace;
  runOnlyPendingTimers(): ArgusNamespace;
  clearAllTimers(): ArgusNamespace;
  getTimerCount(): number;
  setSystemTime(now?: number | Date): ArgusNamespace;
  getRealSystemTime(): number;
}

export function installArgusNamespace(g: Record<string, unknown>): void {
  const timers = createFakeTimers(g);
  let namespace: ArgusNamespace;
  namespace = {
    fn: argusFn,
    spyOn: argusSpyOn,
    mockNativeModule,
    resetNativeModules,
    useFakeTimers(config): ArgusNamespace {
      timers.useFakeTimers(config);
      return namespace;
    },
    useRealTimers(): ArgusNamespace {
      timers.useRealTimers();
      return namespace;
    },
    advanceTimersByTime(ms): ArgusNamespace {
      timers.advanceTimersByTime(ms);
      return namespace;
    },
    advanceTimersByTimeAsync: timers.advanceTimersByTimeAsync,
    runAllTimers(): ArgusNamespace {
      timers.runAllTimers();
      return namespace;
    },
    runOnlyPendingTimers(): ArgusNamespace {
      timers.runOnlyPendingTimers();
      return namespace;
    },
    clearAllTimers(): ArgusNamespace {
      timers.clearAllTimers();
      return namespace;
    },
    getTimerCount: timers.getTimerCount,
    setSystemTime(now): ArgusNamespace {
      timers.setSystemTime(now);
      return namespace;
    },
    getRealSystemTime: timers.getRealSystemTime,
  };
  g.argus = namespace;
}

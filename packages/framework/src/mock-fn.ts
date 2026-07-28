/**
 * @arguslab/framework — in-realm mock functions.
 *
 * Hermes envelope: no async arrows, no async generators, no WeakRef/Intl.
 * Runtime record operations use index loops and direct length mutation.
 */

type MockImpl = (...args: unknown[]) => unknown;

export interface MockResult {
  type: 'return' | 'throw';
  value: unknown;
}

export interface MockRecord {
  calls: unknown[][];
  results: MockResult[];
  instances: unknown[];
}

export interface MockFn {
  (...args: unknown[]): unknown;
  mock: MockRecord;
  mockReturnValue(value: unknown): MockFn;
  mockReturnValueOnce(value: unknown): MockFn;
  mockImplementation(fn: MockImpl): MockFn;
  mockImplementationOnce(fn: MockImpl): MockFn;
  mockResolvedValue(value: unknown): MockFn;
  mockRejectedValue(value: unknown): MockFn;
  mockClear(): MockFn;
  mockReset(): MockFn;
  mockRestore?: () => MockFn;
}

type OnceEntry = { kind: 'return'; value: unknown } | { kind: 'impl'; value: MockImpl };
type MutableMockFn = MockFn & { __mockState?: MockState };

interface MockState {
  defaultImpl: MockImpl | undefined;
  onceQueue: OnceEntry[];
  returnValueSet: boolean;
  returnValue: unknown;
}

const liveMocks: MockFn[] = [];

function append<T>(arr: T[], item: T): void {
  arr[arr.length] = item;
}

function copyArguments(args: IArguments): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < args.length; i++) {
    out[i] = args[i];
  }
  return out;
}

function makeResolved(value: unknown): MockImpl {
  return function resolved(): Promise<unknown> {
    return new Promise(function executor(resolve: (x: unknown) => void): void {
      resolve(value);
    });
  };
}

function makeRejected(value: unknown): MockImpl {
  return function rejected(): Promise<unknown> {
    return new Promise(function executor(
      _resolve: (x: unknown) => void,
      reject: (x: unknown) => void,
    ): void {
      reject(value);
    });
  };
}

function clearRecord(record: MockRecord): void {
  record.calls.length = 0;
  record.results.length = 0;
  record.instances.length = 0;
}

function resetState(state: MockState): void {
  state.defaultImpl = undefined;
  state.onceQueue.length = 0;
  state.returnValueSet = false;
  state.returnValue = undefined;
}

function invokeBehaviour(state: MockState, self: unknown, args: unknown[]): unknown {
  if (state.onceQueue.length > 0) {
    const entry = state.onceQueue[0];
    for (let i = 1; i < state.onceQueue.length; i++) {
      state.onceQueue[i - 1] = state.onceQueue[i];
    }
    state.onceQueue.length = state.onceQueue.length - 1;
    if (entry.kind === 'return') return entry.value;
    return entry.value.apply(self, args);
  }
  if (state.returnValueSet) return state.returnValue;
  if (state.defaultImpl !== undefined) return state.defaultImpl.apply(self, args);
  return undefined;
}

export function argusFn(impl?: MockImpl): MockFn {
  const state: MockState = {
    defaultImpl: impl,
    onceQueue: [],
    returnValueSet: false,
    returnValue: undefined,
  };
  const record: MockRecord = { calls: [], results: [], instances: [] };

  function mockFn(this: unknown): unknown {
    // biome-ignore lint/complexity/noArguments: spread not allowed in Hermes 0.17
    const callArgs = copyArguments(arguments);
    record.calls[record.calls.length] = callArgs;
    record.instances[record.instances.length] = this;
    try {
      const value = invokeBehaviour(state, this, callArgs);
      record.results[record.results.length] = { type: 'return', value };
      return value;
    } catch (e) {
      record.results[record.results.length] = { type: 'throw', value: e };
      throw e;
    }
  }

  const mock = mockFn as MutableMockFn;
  mock.mock = record;
  mock.__mockState = state;
  mock.mockReturnValue = function mockReturnValue(value: unknown): MockFn {
    state.returnValueSet = true;
    state.returnValue = value;
    return mock;
  };
  mock.mockReturnValueOnce = function mockReturnValueOnce(value: unknown): MockFn {
    append(state.onceQueue, { kind: 'return', value });
    return mock;
  };
  mock.mockImplementation = function mockImplementation(fn: MockImpl): MockFn {
    state.defaultImpl = fn;
    state.returnValueSet = false;
    state.returnValue = undefined;
    return mock;
  };
  mock.mockImplementationOnce = function mockImplementationOnce(fn: MockImpl): MockFn {
    append(state.onceQueue, { kind: 'impl', value: fn });
    return mock;
  };
  mock.mockResolvedValue = function mockResolvedValue(value: unknown): MockFn {
    state.defaultImpl = makeResolved(value);
    state.returnValueSet = false;
    state.returnValue = undefined;
    return mock;
  };
  mock.mockRejectedValue = function mockRejectedValue(value: unknown): MockFn {
    state.defaultImpl = makeRejected(value);
    state.returnValueSet = false;
    state.returnValue = undefined;
    return mock;
  };
  mock.mockClear = function mockClear(): MockFn {
    clearRecord(record);
    return mock;
  };
  mock.mockReset = function mockReset(): MockFn {
    clearRecord(record);
    resetState(state);
    return mock;
  };

  append(liveMocks, mock);
  return mock;
}

export function argusSpyOn(obj: Record<string, unknown>, method: string | number | symbol): MockFn {
  const original = obj[method as keyof typeof obj];
  if (typeof original !== 'function') {
    throw new Error(`argus.spyOn() requires a function property: ${String(method)}`);
  }
  const spy = argusFn(original as MockImpl);
  spy.mockRestore = function mockRestore(): MockFn {
    obj[method as keyof typeof obj] = original;
    return spy;
  };
  obj[method as keyof typeof obj] = spy;
  return spy;
}

export function autoResetMocks(): void {
  for (let i = 0; i < liveMocks.length; i++) {
    liveMocks[i].mockClear();
  }
}

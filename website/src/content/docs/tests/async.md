---
title: Async tests
description: Promises, async matchers, and why standalone Hermes timers are a queue rather than a clock.
sidebar:
  order: 3
---

Test bodies and hooks may be `async`. The runner awaits them, and drains Hermes' microtask
queue between tests.

```ts
describe('loadUser', () => {
  test('resolves a user', async () => {
    const user = await loadUser('u1');
    expect(user.id).toBe('u1');
  });

  test('rejects an unknown id', async () => {
    await expect(loadUser('nope')).rejects.toThrow('not found');
  });
});
```

## `.resolves` and `.rejects`

Every matcher has an async twin. `.resolves` awaits the promise and asserts on its value;
`.rejects` awaits the rejection and asserts on the reason.

```ts
await expect(fetchTotal()).resolves.toBe(1200);
await expect(fetchTotal()).resolves.toBeGreaterThan(0);
await expect(fetchTotal()).resolves.not.toBeNull();

await expect(fetchTotal()).rejects.toThrow(TypeError);
await expect(fetchTotal()).rejects.toEqual(new Error('offline'));
```

**Always `await` them.** An un-awaited async matcher is a floating promise: the test
finishes before the assertion resolves, and the failure surfaces as an unhandled rejection
somewhere unhelpful rather than as this test failing.

```ts
expect(fetchTotal()).resolves.toBe(1200);        // ✗ nothing is asserted before the test ends
await expect(fetchTotal()).resolves.toBe(1200);  // ✓
```

Pair them with `expect.hasAssertions()` when the shape of the test makes it easy to forget.

## Async hooks

All four hooks may be async and are awaited in order.

```ts
describe('with a warm cache', () => {
  beforeAll(async () => {
    await warmCache();
  });

  afterEach(async () => {
    await cache.clear();
  });
});
```

## The timer queue is not a clock

This is the one that surprises people. Standalone Hermes exposes `setTimeout` and
`clearTimeout`, but **ignores the delay argument**. Timers run as a FIFO queue and the VM
drains pending timers after the script ends. A chain of thousands of
`setTimeout(callback, 1000)` registrations can therefore finish in almost no wall-clock
time.

`setInterval`, `performance`, and the browser's `MessageChannel` are absent. Argus adds a
minimal `MessageChannel` only so React 19's async `act` can flush work; it does not turn the
timer queue into a clock.

What the environment does have, installed by the Argus polyfill:

| Global | Notes |
|---|---|
| `console.log` / `info` / `debug` / `warn` / `error` | Built on Hermes' `print`. Output is captured and shown under `[user logs]`. |
| `queueMicrotask` | Backed by `Promise.resolve().then`. |
| `global` | Alias of `globalThis`, matching React Native. |
| `MessageChannel` | Minimal two-port task primitive used by React async `act`. |
| `setTimeout` / `clearTimeout` | Native FIFO task queue; delay is ignored. |
| `Promise`, `async` / `await` | Native to the engine. |

This yields to the timer queue, but does **not** wait 10 ms:

```ts
const started = Date.now();
await new Promise((resolve) => setTimeout(resolve, 10));
// Date.now() - started can still be 0
```

Promise microtasks remain available:

```ts
// ✓ yields to the microtask queue
await Promise.resolve();
await new Promise<void>((resolve) => queueMicrotask(resolve));
```

### Testing time-dependent code

Use `argus.useFakeTimers()` when elapsed time is the behaviour under test. This is the
opposite of the usual trade-off: on standalone Hermes, a fake clock is **more faithful** to
a React Native device than the native timer queue because it observes the delay explicitly.

```ts
describe('debounce', () => {
  afterEach(() => argus.useRealTimers());

  test('waits for its delay', () => {
    argus.useFakeTimers({ now: 1000 });
    let fired = false;
    setTimeout(() => { fired = true; }, 300);

    expect(fired).toBe(false);
    argus.advanceTimersByTime(299);
    expect(fired).toBe(false);
    argus.advanceTimersByTime(1);
    expect(fired).toBe(true);
  });
});
```

The supported Jest-shaped controls are:

| Method | Behaviour |
|---|---|
| `useFakeTimers({ now, timerLimit })` | Installs a fresh fake `Date`, timeout and interval clock. |
| `useRealTimers()` | Restores globals captured before user code ran. |
| `advanceTimersByTime(ms)` | Runs every timer due in the interval, including newly scheduled ones. |
| `advanceTimersByTimeAsync(ms)` | Drains promise callbacks on V1; grants 100 captured real scheduler turns between timers on legacy. |
| `runAllTimers()` | Recursively drains timers, bounded by `timerLimit` (default `100000`). |
| `runOnlyPendingTimers()` | Runs through the latest due time pending when the call began, including new timers due inside that window. |
| `clearAllTimers()` | Clears timers and resets fake time to its installation value. |
| `getTimerCount()` | Counts pending fake timeouts and intervals. |
| `setSystemTime(now?)` | Moves `Date` without changing remaining timer delays; omitted `now` means epoch `0`. |
| `getRealSystemTime()` | Reads real wall time while `Date.now()` is fake. |

Fake timers remain active across tests in the file, matching Jest. Argus does not reset them
automatically; use `afterEach(() => argus.useRealTimers())` for test-local clocks. Calling
`useFakeTimers()` again discards pending fake timers and installs a fresh clock.

Hermes V1 exposes an engine promise queue, so one captured real scheduler turn drains a
finite promise chain before the next fake timer. Legacy Hermes uses a Promise polyfill that
may advance only one chained callback per scheduler turn and exposes no queue-drain
primitive. Argus therefore grants 100 captured real turns between timers. This covers
ordinary chains but cannot equal Jest's unbounded Node microtask drain beyond that explicit
limit; await or split exceptionally deep promise work instead.

`queueMicrotask` remains real. Standalone Hermes has no `performance`, animation-frame,
idle-callback, or immediate APIs to fake. Argus also omits Jest's automatic advancement,
`doNotFake`, and legacy-timer modes: partial or native-clock advancement would reintroduce
the standalone VM's zero-delay behaviour instead of fixing it.

Dependency-injected clocks remain useful for domain logic. Fake timers cover code whose
contract is the global React Native timer API, especially debounce, throttle and retry code.

Component polling uses a separate real scheduler. `waitFor` accepts RNTL-compatible
`{ timeout, interval }` options, but applies both a real `Date.now()` deadline and a
scheduler-turn budget derived from `ceil(timeout / interval)`. That second budget prevents
the zero-delay queue from spinning until the per-file timeout kills the process. See
[Component testing](/tests/components/#async-queries-and-waits).

Those internal timer and `Date.now` references are captured before user code runs, so fake
system time cannot freeze or instantly exhaust a wait's own safety budget.

## Per-file timeout

The whole file — bundling excluded — has to finish within `--timeout`, default 10000 ms.

```bash
argus --timeout 30000 "src/**/*.test.ts"
```

Exceeding it kills the Hermes process and reports the file as a `timeout` outcome, exit
code 2. There is no per-test timeout: the unit of isolation is the file, so the unit of
timeout is too.

A hung promise that never settles will hit this. `waitFor` protects its own callback with
the dual budget above, but an arbitrary `await` still has no per-test preemption.

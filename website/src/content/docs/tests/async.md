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

Inject the clock instead of reaching for a global one. Code that takes its time source as a
parameter is testable on any engine, and does not need fake timers on any of them.

```ts
// ✗ coupled to a wall clock the standalone VM does not provide
export function isExpired(token: Token) {
  return token.expiresAt < Date.now();
}

// ✓ testable everywhere
export function isExpired(token: Token, now: number) {
  return token.expiresAt < now;
}

test('detects an expired token', () => {
  expect(isExpired({ expiresAt: 100 }, 200)).toBe(true);
});
```

For debounce, throttle and retry logic, take the scheduler as a dependency and pass a
synchronous one in tests. A raw `setTimeout` test in Argus can prove task ordering, not
elapsed-time behaviour from the React Native host.

Component polling is the deliberate exception. `waitFor` accepts RNTL-compatible
`{ timeout, interval }` options, but applies both a real `Date.now()` deadline and a
scheduler-turn budget derived from `ceil(timeout / interval)`. That second budget prevents
the zero-delay queue from spinning until the per-file timeout kills the process. See
[Component testing](/tests/components/#async-queries-and-waits).

Fake timers remain on the [roadmap](/reference/roadmap/); the native FIFO queue is not a
fake-timer API.

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

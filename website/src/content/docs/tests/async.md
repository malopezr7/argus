---
title: Async tests
description: Promises, async matchers, and the one thing standalone Hermes does not give you — timers.
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

## There are no timers

This is the one that surprises people. **Standalone Hermes has no `setTimeout`,
`setInterval` or `setImmediate`.**

Those are not part of the JavaScript language — they are host APIs. In a browser the
browser provides them; in Node, Node does; in React Native, the RN runtime does. The bare
`hermes` VM provides none of them, and Argus deliberately does not invent them, because a
fake timer that is not the one your app runs on is the exact kind of "close enough" this
project exists to avoid.

What the environment does have, installed by the Argus polyfill:

| Global | Notes |
|---|---|
| `console.log` / `info` / `debug` / `warn` / `error` | Built on Hermes' `print`. Output is captured and shown under `[user logs]`. |
| `queueMicrotask` | Backed by `Promise.resolve().then`. |
| `global` | Alias of `globalThis`, matching React Native. |
| `Promise`, `async` / `await` | Native to the engine. |

So this **does not work**:

```ts
// ✗ ReferenceError: setTimeout is not defined
await new Promise((resolve) => setTimeout(resolve, 10));
```

And this does:

```ts
// ✓ yields to the microtask queue
await Promise.resolve();
await new Promise<void>((resolve) => queueMicrotask(resolve));
```

### Testing time-dependent code anyway

Inject the clock instead of reaching for a global one. Code that takes its time source as a
parameter is testable on any engine, and does not need fake timers on any of them.

```ts
// ✗ untestable without timers
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
synchronous one in tests.

Fake timers are on the [roadmap](/reference/roadmap/) as part of the component-testing
work, not as a general polyfill.

## Per-file timeout

The whole file — bundling excluded — has to finish within `--timeout`, default 10000 ms.

```bash
argus --timeout 30000 "src/**/*.test.ts"
```

Exceeding it kills the Hermes process and reports the file as a `timeout` outcome, exit
code 2. There is no per-test timeout: the unit of isolation is the file, so the unit of
timeout is too.

A hung promise that never settles will hit this. Because there are no timers, the usual
cause is awaiting something that nothing will ever resolve.

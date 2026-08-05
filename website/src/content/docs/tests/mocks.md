---
title: Mocks & spies
description: argus.fn(), argus.spyOn(), the mock record, and why the namespace is not called jest.
sidebar:
  order: 4
---

Mocking lives on the `argus` global, installed inside the Hermes realm alongside `expect`.

```ts
const send = argus.fn();
send('hello');
expect(send).toHaveBeenCalledWith('hello');
```

## Why `argus` and not `jest`

There is no `jest` global, and that is deliberate. A `jest` namespace that implements
two-thirds of Jest is worse than no `jest` namespace: code copied from a Jest suite would
appear to work until it silently reached the third that is missing.

`argus.*` is honest about which runner you are on. `globalThis.jest` is `undefined`, and a
test can assert that.

## `argus.fn()`

Creates a mock function. Optionally takes a default implementation.

```ts
const noop = argus.fn();
const double = argus.fn((n: number) => n * 2);

expect(double(4)).toBe(8);
```

### Controlling what it returns

| Method | Effect |
|---|---|
| `mockReturnValue(v)` | Always return `v` |
| `mockReturnValueOnce(v)` | Return `v` for the next call only, FIFO |
| `mockImplementation(fn)` | Replace the default implementation |
| `mockImplementationOnce(fn)` | Use `fn` for the next call only, FIFO |
| `mockResolvedValue(v)` | Return a promise resolving to `v` |
| `mockRejectedValue(v)` | Return a promise rejecting with `v` |

All of them return the mock, so they chain.

```ts
const load = argus.fn();
load.mockReturnValue('default');
load.mockReturnValueOnce('first');
load.mockReturnValueOnce('second');

expect([load(), load(), load()]).toEqual(['first', 'second', 'default']);
```

The `*Once` queue drains first-in-first-out, and falls back to `mockReturnValue`, then to
the default implementation, then to `undefined`.

```ts
const fetchUser = argus.fn();
fetchUser.mockResolvedValue({ id: 'u1' });

await expect(fetchUser()).resolves.toEqual({ id: 'u1' });
```

### The mock record

Every call is recorded on `.mock`.

```ts
const fn = argus.fn((n: number) => n + 1);
fn(1);
fn(2);

fn.mock.calls;      // [[1], [2]]
fn.mock.results;    // [{ type: 'return', value: 2 }, { type: 'return', value: 3 }]
fn.mock.instances;  // receivers, for calls made as methods
```

A call that threw is recorded as `{ type: 'throw', value: <the error> }`, so a thrown
result is still observable rather than lost.

Prefer the [matchers](/tests/matchers/#mock-and-spy-matchers) over reading `.mock` by hand
— they produce far better failure messages. Reach for the record when you need something
the matchers do not express.

### Clearing and resetting

| Method | Clears calls | Clears configured behaviour |
|---|---|---|
| `mockClear()` | yes | no |
| `mockReset()` | yes | yes |
| `mockRestore()` | yes | yes, and restores the original (spies only) |

Call records are cleared automatically between tests, so a mock created in `beforeEach`
starts each test clean without any bookkeeping from you. Configured behaviour is not
auto-reset — set it where you want it to apply.

## `argus.spyOn()`

Wraps an existing method, recording calls while still delegating to the original.

```ts
const logger = {
  warn(message: string) {
    /* real implementation */
  },
};

const spy = argus.spyOn(logger, 'warn');

logger.warn('careful');

expect(spy).toHaveBeenCalledWith('careful');

spy.mockRestore(); // put the original method back
```

A spy is a full mock function, so everything above applies — including replacing the
behaviour outright:

```ts
argus.spyOn(logger, 'warn').mockImplementation(() => {});
```

Spying on a property that is not a function throws immediately
(`argus.spyOn() requires a function property: …`) rather than producing a mock that
silently swallows calls.

## What is not here

- **`jest.mock('module', factory)`.** There is no module registry to intercept: everything
  is bundled up front, before the VM starts. For native modules use
  [`argus.mockNativeModule`](/tests/native-modules/); for your own modules, inject the
  dependency rather than rewriting the module graph.
- **Automatic module mocking.** Same reason.

Time control lives on the separate `argus` namespace rather than a `jest` global — see
[Async tests](/tests/async/#testing-time-dependent-code).

## Design note

The mock implementation uses index loops and direct `length` mutation instead of
`Array.prototype` methods and iterators. That is not stylistic: mocks run in the same realm
as your test, and a test that replaces `Array.prototype.push` or the array iterator must
not be able to corrupt the runner's own bookkeeping.

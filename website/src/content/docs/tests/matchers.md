---
title: Matchers
description: The full expect surface — equality, numbers, strings, collections, objects, throwing, negation, custom matchers and assertion counting.
sidebar:
  order: 2
---

`expect` is a global inside the Hermes realm. Every matcher below also works negated
through `.not`, and asynchronously through `.resolves` / `.rejects` — see
[Async tests](/tests/async/).

## Equality

| Matcher | Passes when |
|---|---|
| `toBe(expected)` | `Object.is`-style identity (`SameValueZero`) |
| `toEqual(expected)` | Recursively equal, ignoring `undefined` properties |
| `toStrictEqual(expected)` | Recursively equal, `undefined` properties significant, types must match |

```ts
expect({ a: 1 }).toEqual({ a: 1 });                     // pass — different objects, same shape
expect({ a: 1 }).toBe({ a: 1 });                        // fail — not the same object
expect({ a: 1, b: undefined }).toEqual({ a: 1 });        // pass
expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 });  // fail
```

## Truthiness and nullishness

```ts
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();
expect(value).toBeNaN();
```

## Numbers

```ts
expect(total).toBeGreaterThan(0);
expect(total).toBeGreaterThanOrEqual(100);
expect(total).toBeLessThan(1000);
expect(total).toBeLessThanOrEqual(999);
expect(0.1 + 0.2).toBeCloseTo(0.3);        // default precision: 2 digits
expect(0.1 + 0.2).toBeCloseTo(0.3, 10);
```

## Strings

```ts
expect(slug).toMatch('checkout');           // substring
expect(slug).toMatch(/^checkout-\d+$/);     // pattern
```

## Collections

```ts
expect(items).toHaveLength(3);
expect(items).toContain('A1');               // identity
expect(items).toContainEqual({ sku: 'A1' }); // deep equality
```

`toContain` and `toContainEqual` work on arrays and strings.

## Objects

```ts
expect(user).toHaveProperty('address.city');
expect(user).toHaveProperty('address.city', 'Madrid');
expect(user).toHaveProperty(['tags', 0], 'beta');

expect(response).toMatchObject({ status: 200, body: { ok: true } });
```

`toHaveProperty` takes a dotted path or an array of keys. `toMatchObject` checks that the
received object contains at least the given subset, recursively.

## Throwing

```ts
expect(() => parse('')).toThrow();
expect(() => parse('')).toThrow(RangeError);    // constructor
expect(() => parse('')).toThrow('empty input'); // substring of the message
expect(() => parse('')).toThrow(/empty/);       // pattern
```

The argument must be a function. Handing `toThrow` a value that has already thrown is a
usage error, not a silent pass.

## Negation

`.not` inverts any matcher, including the async forms.

```ts
expect(total).not.toBe(0);
expect(items).not.toContain('A9');
await expect(load()).resolves.not.toBeNull();
```

## Mock and spy matchers

Available on anything created with `argus.fn()` or `argus.spyOn()` — see
[Mocks & spies](/tests/mocks/).

```ts
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledTimes(3);
expect(fn).toHaveBeenCalledWith(1, 'a');
expect(fn).toHaveBeenLastCalledWith(9);
expect(fn).toHaveBeenNthCalledWith(1, 'a');

expect(fn).toHaveReturned();
expect(fn).toHaveReturnedTimes(3);
expect(fn).toHaveReturnedWith(10);
expect(fn).toHaveLastReturnedWith(10);
expect(fn).toHaveNthReturnedWith(2, 2);
```

Argument comparison is deep equality, so object arguments match by shape.

## Custom matchers

`expect.extend` merges a table of matchers into the global set. A matcher returns
`{ pass, message }`; `message` is a function so the string is only built when it is needed.

```ts
expect.extend({
  toBeWithin(actual: number, min: number, max: number) {
    const pass = actual >= min && actual <= max;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${actual} not to be within ${min}..${max}`
          : `expected ${actual} to be within ${min}..${max}`,
    };
  },
});

expect(elapsed).toBeWithin(0, 100);
expect(elapsed).not.toBeWithin(500, 1000);
```

Negation is handled for you — return `pass` as if the assertion were positive.

## Assertion counting

Useful when a test's assertions live in a callback that might never run.

```ts
test('calls back exactly once', () => {
  expect.assertions(1);
  withRetry(() => {
    expect(true).toBe(true);
  });
});

test('asserts something', async () => {
  expect.hasAssertions();
  await expect(load()).resolves.toBeDefined();
});
```

`expect.assertions(n)` requires exactly `n`; `expect.hasAssertions()` requires at least one.

Counting happens at matcher **invocation**, not inside the assertion. A matcher that throws
a usage error before asserting — `toThrow` on a non-function, `toEqual` on a `Map` — still
counts exactly once, so a guard failure cannot masquerade as "no assertions ran".

## Failure messages

Values are rendered by a Hermes-safe formatter rather than `JSON.stringify`. A test that
has poisoned `Object.prototype` or replaced `Array.prototype.push` still produces a
readable message instead of taking the reporter down with it.

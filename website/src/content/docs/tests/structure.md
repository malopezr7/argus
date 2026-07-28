---
title: Test structure
description: describe, test, it, the four lifecycle hooks, and the .skip / .only / .todo modifiers.
sidebar:
  order: 1
---

The test API is installed as globals inside the Hermes realm. There is nothing to import.

```ts title="src/cart.test.ts"
import { Cart } from './cart';

describe('Cart', () => {
  let cart: Cart;

  beforeEach(() => {
    cart = new Cart();
  });

  test('starts empty', () => {
    expect(cart.items).toHaveLength(0);
  });

  test('adds an item', () => {
    cart.add({ sku: 'A1', price: 500 });
    expect(cart.total).toBe(500);
  });
});
```

## Every test lives inside a `describe`

This is the one structural difference from Jest that will bite you on the first file:

```ts
// ✗ throws: test("…") called outside of describe()
test('adds an item', () => { /* … */ });
```

A bare top-level `test` throws at registration time, and so does a hook registered outside
a suite (`Hook called outside of describe()`). Wrap them.

The reason is that hooks belong to a suite. Allowing suite-less tests would mean inventing
an implicit root suite whose lifecycle semantics differ from every explicit one.

## `test` and `it`

`it` is the same function object as `test`, not a wrapper around it. Use whichever reads
better; both take the same modifiers.

```ts
it('rounds half up', () => { /* … */ });
```

The body may be omitted, which registers the test as pending rather than failing.

## Nesting

Suites nest to any depth. Reports preserve the tree, and hooks compose down it.

```ts
describe('Cart', () => {
  describe('when empty', () => {
    test('has a zero total', () => {
      expect(new Cart().total).toBe(0);
    });
  });

  describe('with items', () => {
    test('sums prices', () => { /* … */ });
  });
});
```

## Lifecycle hooks

| Hook | Runs |
|---|---|
| `beforeAll(fn)` | Once, before the first test in its suite |
| `afterAll(fn)` | Once, after the last test in its suite |
| `beforeEach(fn)` | Before every test in its suite and every nested suite |
| `afterEach(fn)` | After every test in its suite and every nested suite |

`beforeEach` hooks run outermost-first; `afterEach` hooks run innermost-first — the usual
nesting order. Hooks may be `async`; the runner awaits them.

```ts
describe('with a seeded store', () => {
  beforeAll(async () => {
    await seed();
  });

  afterEach(() => {
    store.reset();
  });

  test('reads a seeded row', () => { /* … */ });
});
```

`afterEach` hooks run even when the test failed, so cleanup is not conditional on success.

## Skipping, focusing, and to-dos

```ts
describe.skip('not yet migrated', () => { /* nothing here runs */ });
describe.only('the one I am debugging', () => { /* … */ });

test.skip('flaky on CI', () => { /* … */ });
test.only('this one', () => { /* … */ });
test.todo('handles refunds');
```

Semantics worth knowing:

- **`.only` is file-scoped.** Focusing in one file does not silence other files. Each file
  is its own process and its own realm — a global "only" would need cross-process
  coordination the design does not have.
- **`.only` inside a skipped suite stays skipped.** Skip wins over focus; an ancestor's
  `.skip` is not undone by a descendant's `.only`.
- **`.todo` takes no body.** Any function you pass is ignored on purpose, and a `.todo`
  placeholder does **not** trigger lifecycle hooks — it is a note, not an execution.
- Todos are counted separately in the summary (`3 passed, 0 failed, 1 todo, 4 total`) and
  never affect the exit code.

## Where files are discovered

Positional arguments are globs. With none, the defaults are `**/*.test.ts` and
`**/*.test.tsx`.

```bash
argus                                  # both defaults
argus "src/**/*.test.ts"               # one glob
argus "src/**/*.test.ts" "lib/**/*.test.tsx"
argus src/cart.test.ts                 # a single file
```

`node_modules` is excluded. Discovery order is preserved in the report, which keeps output
stable even though execution is parallel.

:::note
Include and exclude patterns are not configurable yet — there is no config file. It is the
next thing after distribution on the [roadmap](/reference/roadmap/).
:::

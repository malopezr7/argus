---
title: The syntax envelope
description: What the bundler lowers for you, what it cannot, and why some dependencies still fail to parse on the legacy engine.
sidebar:
  order: 5
---

Your test file is TypeScript. The thing that runs is a bundle, lowered for the engine you
target. The gap between the two is the syntax envelope.

Everything below is derived from the binaries themselves by
`test/hermes-syntax-probe.test.ts`, not written by hand. Prose about this drifts — two
claims this project shipped were contradicted by the engines when they were finally probed.

## On Hermes V1

Almost nothing to worry about. V1 parses `class` in every form, private fields, static
blocks, `async` arrow functions, `for await…of` and `WeakRef`. Write modern TypeScript.

**One exception: V1 rejects `async function*`.** It is not a superset of legacy — async
generators fail there exactly as they do on legacy, with the same
`async generators are unsupported`. esbuild lowers them for you on both engines.

The other real constraint is **host APIs, not syntax** — the standalone VM's timer queue
ignores delays, and it has no `fetch` or `require`. See
[Async tests](/tests/async/#the-timer-queue-is-not-a-clock).

## On the legacy engine

The legacy engine parses **no `class` syntax at all**. Not "supports it partially" — the
parser rejects it with `invalid statement encountered`.

That means no classes, no private fields (`#x`), no static blocks, no `WeakRef` or
`FinalizationRegistry`.

`async` is the subtle one, and it is easy to state backwards:

| Form | Legacy |
|---|---|
| `async function f() {}`, methods, expressions | **Runs** |
| `async () => {}` | Rejected |
| `async function* g() {}` | Rejected (V1 too) |

The rejection message for the arrow reads `async functions are unsupported`, which is what
makes this so easy to get wrong — the engine names the wrong thing. esbuild has a single
`async-await` lever and cannot lower only the arrow, so Argus lowers `async` wholesale on
legacy rather than rewriting every arrow in your code.

esbuild handles most of this for you when targeting legacy:

| You write | What runs |
|---|---|
| `class Foo {}` | a lowered constructor function |
| `async () => {}` | a lowered generator-driven state machine |
| `await` | lowered by esbuild's `async-await: false` support flag |
| `for…of`, spread, destructuring | lowered as needed |
| TypeScript types | erased |

### Dependencies that ship classes

Your own code is lowered by the bundler's target settings. Third-party code in
`node_modules` is a different matter — it is often already-compiled JavaScript that
esbuild passes through.

Argus runs a scoped Babel class-lowering plugin over `node_modules` sources when targeting
legacy. It is deliberately narrow:

- `node_modules` only — your own sources go through esbuild's normal target lowering.
- Sniff-gated on a `class` pattern, so files without classes pay nothing.

This exists **only** to work around a legacy parser limitation. On V1 it is unnecessary,
and it is scoped to the legacy compatibility target for exactly that reason.

If a dependency still fails to parse, that is the signal to check whether it is compatible
with the engine your app ships at all — the failure is real, not an artifact of testing.

## Inside the framework itself

Code that Argus bundles into the Hermes realm — the framework, matchers, the runner, the
result serializer — follows a stricter rule than the envelope requires:

- **Index loops only** in the runner, deep-equality and serializer paths. No `for…of`, no
  spread, no `Array.prototype` methods.
- No `JSON.stringify` in result emission.
- Primordials (`print`, `Date.now`) captured before user code runs.

Not style. Your test runs in the **same realm** as the runner, and a test that pollutes
`Object.prototype` or replaces the array iterator must not be able to corrupt the runner's
own bookkeeping or the result channel. See [The result protocol](/internals/result-protocol/).

This rule applies to in-Hermes code only. Host-side code — the CLI, the adapters, the
source-map remapper — is ordinary Node and has none of these constraints.

## The bug class this creates

Lowering is a transformation, and transformations have bugs. The one that bit this project:

esbuild lowers a loop-scoped `const` to `var` for the Hermes target. A closure created in
that loop then captures the **last** iteration's value.

```ts
// Correct in source. Wrong once lowered.
for (const key of keys) {
  const original = target[key];
  target[key] = (...args) => wrap(original, args); // every wrapper gets the LAST original
}

// Correct after lowering — the value is captured through a function parameter.
for (const key of keys) {
  target[key] = makeWrapper(target[key]);
}
function makeWrapper(original) {
  return (...args) => wrap(original, args);
}
```

Node passes this. Vitest passes this. Only a real Hermes run catches it, because the bug
does not exist until the bundle is lowered.

Which is the whole argument for this tool: **run the artifact, on the engine.**

## JSX

Bundled with the automatic runtime, `jsxImportSource: 'react'`, and `jsxDev: true`. `__DEV__`
is defined as `true` and `process.env.NODE_ENV` as `"development"` — matching a React Native
development bundle, which is what you want under test.

---
title: Source maps
description: Why a stack from Hermes points at your TypeScript instead of at a 4000-line bundle.
sidebar:
  order: 3
---

Hermes runs a bundle. Without remapping, every failure frame would read:

```text
at run.argus-bundle.js:2418:19
```

Which tells you nothing. Argus remaps every stack through the bundle's external source map
before anything is printed:

```text
at src/cart.test.ts:24:28
```

## How it works

esbuild emits an external source map alongside the sealed bundle. After a result comes back
from Hermes, the host walks the result tree and rewrites every `failureStack`, frame by
frame, through that map.

Frames that resolve to Argus' own internals — the framework, the polyfills, the virtual
entry — are dropped, so the stack you read is your code and only your code.

## Two rules this code lives by

### Remapping must be total

`remapStacks` must **never throw**.

A throw during reporting would be caught by the runner's own error handling and demote a
real test failure (exit 1) into an infrastructure failure (exit 2). The most useful signal
in the run would be destroyed by the code whose only job is to present it.

So every lookup, every consumer construction and every tree walk is guarded. A map that
cannot be parsed, a frame that resolves to nothing, a stack in an unexpected format — all
degrade to the unmapped original, which is worse than a mapped stack and infinitely better
than a lost failure.

### Internal-source detection is a prefix match

Deciding "is this frame Argus' own code?" is a **`startsWith`** check, not a substring
check.

A substring check misclassifies a user path like `examples/packages/core/foo.test.ts` as
internal, and silently leaves your own frames unmapped. It looks like a source-map bug and
is actually a classification bug.

## What you get

```text
Cart
  ✗ applies a discount  — expected 450 but received 500
    at applyDiscount (src/cart.ts:41:11)
    at src/cart.test.ts:24:28
```

Both frames — the assertion site in the test and the call site in the implementation —
resolved back to TypeScript, with the columns intact.

## Limits

- Only stacks Hermes actually produced are remapped. An error whose `stack` was replaced by
  user code is passed through as-is.
- The map is per bundle, and a bundle is per file, so cross-file frames do not arise.
- Frame *format* is Hermes' own. Argus rewrites locations; it does not normalise Hermes'
  stack shape into V8's. If your code parses `error.stack`, that difference is exactly the
  kind of thing you want to see rather than have papered over — see
  [Why Hermes, not Node](/start/why-hermes/).

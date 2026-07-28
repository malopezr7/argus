---
title: The result protocol
description: How a hostile same-realm test is prevented from forging, corrupting or suppressing the run's result.
sidebar:
  order: 2
---

Argus treats the Hermes process as an **untrusted same-realm execution environment**.

Your tests run in the same realm as the runner. They can override globals, replace
prototype methods, poison `Object.prototype`, hijack iterators, redefine `toJSON`, and
overwrite `print` itself. Some of them do so on purpose — that is a legitimate thing to
test.

None of it may compromise the answer that comes back.

## The channel

One line on stdout:

```text
__ARGUS_RESULT__:<nonce>:<json>
```

stdout also carries your `console.log` output, so the frame has to be both unambiguous and
unforgeable.

## The five defences

### 1. Captured primordials

Before any user code evaluates, the framework captures what it needs:

```ts
const safePrint = print;
const safeDateNow = Date.now;
```

A test that later replaces `print` or `Date.now` changes only its own view. The reporting
path already holds the originals.

### 2. A private per-run nonce

Random per bundle, inlined in the **virtual entry's module scope**. Test modules are
separate scopes and cannot read it.

The host accepts exactly one framed line carrying that exact nonce. A test that prints a
convincing-looking result frame is ignored — it cannot know the value.

Crucially the nonce is *not* injected as a global `define`, which would put it within reach
of user code.

### 3. A hand-written serializer

Result emission does **not** use `JSON.stringify`.

`JSON.stringify` consults `toJSON` on the values it walks, and calls user-reachable
prototype methods. A test that defines `Object.prototype.toJSON` could change or corrupt
the result payload from the outside.

Instead a small set of functions (`serOkEnvelope` … `serInt`) walks the result shape using
own-property access and index loops only. No array methods, no iterators, nothing
prototype-sensitive.

### 4. Index loops everywhere it counts

In the runner, deep-equality and serializer paths: `for (let i = 0; …)` only. No `for…of`,
no spread, no `Array.prototype.*`.

A test that replaces `Array.prototype.push` or the array iterator cannot reach the runner's
own bookkeeping. Matchers and hooks run in-realm and may use ordinary JavaScript; the
serializer, the primordial capture and the emission path must not.

### 5. The host is strict

- Exactly **one** frame is accepted. Not the first of several.
- The nonce must match exactly.
- The JSON must parse and match the expected shape.
- A **non-zero Hermes exit is an infrastructure failure even if a frame was printed
  earlier** — a process that crashed after reporting did not really report.

Anything else is a `protocol-failure`, and the raw stdout is dumped in full. When the
protocol breaks, everything is the only useful diagnostic left.

## The adversarial fixtures

These properties are not asserted by unit tests alone. The repository carries fixtures that
actively attack the channel on a real Hermes run, and they must stay inert:

| Fixture | Attack |
|---|---|
| `print-hijack` | Replaces `print` after startup |
| `json-hijack` | Replaces `JSON.stringify` |
| `tojson-hijack` | Defines `Object.prototype.toJSON` |
| `push-hijack` | Replaces `Array.prototype.push` |
| `iterator-hijack` | Replaces the array iterator |
| `robustness` | General prototype pollution |
| `forge` | Prints a fabricated result frame |

Each must produce the correct exit code with the real result intact. They are the regression
suite for the whole threat model.

## If you contribute

The result-channel code lives in `packages/framework/src/index.ts`. Treat it as a
high-integrity boundary:

- Never introduce `JSON.stringify`, array methods or iterators into the serializer.
- Never let a matcher's convenience leak into the emission path.
- Never change the serializer casually — every change needs the adversarial fixtures rerun
  on real Hermes, not just a green Node suite.

The rule of thumb: matchers and hooks may be ordinary code; the parts that *report* may
not.

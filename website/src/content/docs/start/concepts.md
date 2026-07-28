---
title: Core concepts
description: The eight ideas that explain every design decision in Argus.
sidebar:
  order: 5
---

Eight terms cover the whole system. Learn these and the rest of the documentation reads
without surprises.

## Sealed bundle

Everything a test file needs, compiled into **one** self-contained IIFE: polyfills, the
Argus framework, your test, its imports, and a virtual entry that starts the run.

This exists because of one hard constraint: **Hermes cannot ask the host for modules at
run time**. There is no `require`, no resolver, no dynamic import back into your project.
Everything must be present before the VM starts.

That constraint is also the design's biggest gift. A run is deterministic, isolated per
file, and trivially parallel.

## Spawn-per-file

One `hermes` process per test file. Not per suite, not per test.

No shared realm between files means no cross-file global leakage, no ordering coupling, and
no cleanup protocol between them. Parallelism is just process parallelism, bounded by
`--concurrency`.

## The result channel

The single line the Hermes process prints to say what happened:

```text
__ARGUS_RESULT__:<nonce>:<json>
```

`stdout` also carries your own `console.log` output, so the framed line has to be
unambiguous and unforgeable. The [result protocol](/internals/result-protocol/) page covers
how — captured primordials, a private nonce, and a hand-written serializer that never
touches `JSON.stringify`.

## Nonce

A random value generated per bundle and inlined into the virtual entry's **module scope**.
Your test modules are separate scopes and cannot read it.

The host accepts exactly one framed line carrying that exact nonce. A test that prints a
convincing-looking result frame is ignored, because it cannot know the nonce.

## Engine: legacy and V1

React Native pins **two** Hermes engines from RN 0.83 on. The legacy engine and Hermes V1
(Static Hermes). RN 0.84 made V1 the default; RN 0.87 dropped legacy entirely.

They are distinguished at run time by HBC bytecode version — 96 for legacy, 98 for V1 — and
a V1 VM refuses legacy bytecode outright rather than misbehaving. See
[Legacy and V1 engines](/hermes/engines/).

## Pin

The specific Hermes ref your React Native install declares. Argus reads it from your
project rather than guessing, in this order:

1. `sdks/hermes-engine/version.properties`
2. `sdks/.hermesv1version`
3. `sdks/.hermesversion`
4. `package.json` → `dependencies['hermes-compiler']`

Only if none of those can be read does it fall back to an offline
[lookup table](/hermes/versions/).

## Provisioning

Turning a pin into an executable binary on this machine. Six sources, most explicit first:
your flag, a project-vendored binary, the cache, the VM bundled inside React Native, a
published prebuilt, and finally an opt-in source build.

Every resolved binary is smoke-tested and its bytecode version checked before it is
trusted. See [How the binary is provisioned](/hermes/provisioning/).

## Outcome

What Argus concluded about one file. The distinction that matters is **a failing test is
not a broken runner**:

| Outcome | Meaning | Exit code |
|---|---|---|
| `passed` | Every test passed | 0 |
| `failed` | The suite ran; some tests failed | 1 |
| `timeout` | The Hermes process outlived `--timeout` | 2 |
| `infrastructure-failure` | Bundling, spawning or provisioning broke | 2 |
| `protocol-failure` | No valid result frame came back | 2 |

A session's exit code is the worst case across its files. See
[Reporting and exit codes](/cli/reporting/).

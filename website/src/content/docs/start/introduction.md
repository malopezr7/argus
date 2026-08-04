---
title: What is Argus
description: A React Native test runner that executes your tests on the standalone Hermes VM instead of Node.
sidebar:
  order: 1
---

Argus runs React Native unit tests on the **standalone Hermes VM** — the same JavaScript
engine your app ships with — without starting Metro, building a native app, or booting a
device or emulator.

The goal is narrow and deliberate: keep the feedback loop at unit-test speed while catching
the bugs that only appear on Hermes and are invisible to a Node/V8 runner.

## The shape of it

Each test file is bundled by esbuild into a sealed IIFE, written to a temp file, and run by
a freshly spawned `hermes` process. The process prints one framed result line; the host
parses it, remaps the stacks, and reports.

```text
argus "src/**/*.test.ts"
  → discover files
  → for each file (bounded parallelism):
        bundle  →  spawn hermes  →  parse framed result  →  remap stacks
  → aggregate  →  report  →  exit with the worst-case code
```

One process per file. No shared realm between files, no cross-test global leakage, and
parallelism that is just process parallelism.

## Where it sits

| Option | Strength | Gap |
|---|---|---|
| Jest / Vitest on Node | Fast, familiar, great DX | Wrong JS engine for RN production |
| On-device / emulator runners | Real app environment | Slow, heavy, needs a native build |
| **Argus** | **Real Hermes VM at unit-test cost** | Not a full RN runtime |

Argus is not trying to be another Jest. It implements a Jest-*shaped* surface where that
buys ergonomics, and stops where the shape would start lying about the engine.

## What works today

- Multi-file discovery with globs, and bounded parallel execution.
- `describe`, `test`, `it`, `expect`, the four lifecycle hooks.
- `.skip`, `.only`, `.todo`.
- Async tests and async matchers through Hermes microtasks.
- A full matcher set: equality, truthiness, numeric, string, collection, object,
  `toThrow`, `.resolves` / `.rejects`, call and return matchers, `expect.extend`,
  assertion counting.
- `argus.fn()`, `argus.spyOn()`, and React Native native-module mocks.
- Source-map based stack remapping back to your original TypeScript.
- Synchronous and bounded asynchronous component testing on real React 19 inside Hermes.
- Hermes provisioning driven by the engine **your** project pins.

## What it is not

Argus is not a React Native runtime. It does not give you Metro semantics, native app
lifecycle, device APIs, real UI rendering, or layout. See
[Limitations & non-goals](/reference/limitations/) — those boundaries are chosen, not
pending.

## Next

- [Why Hermes, not Node](/start/why-hermes/) — the concrete failure modes this closes.
- [Installation](/start/installation/) — get it into a project.
- [Quick start](/start/quickstart/) — first green run.

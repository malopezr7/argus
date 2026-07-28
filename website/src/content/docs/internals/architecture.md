---
title: Architecture
description: The data flow from argv to exit code, and the one constraint that shapes all of it.
sidebar:
  order: 1
---

Argus is a hexagonal design: a pure domain, ports around it, adapters at the edges, and a
CLI as the composition root.

## The whole flow

```text
Host process (Node)
  args
    → resolve framework paths
    → resolve Hermes binary            (provisioning chain)
    → discover test files              (globs)
    → for each file, bounded by concurrency:
         bundle with esbuild
         → write sealed bundle to a temp file
         → spawn standalone hermes
         → parse the framed result line
         → remap stacks with source maps
    → aggregate results                (discovery order)
    → render CLI report
    → exit with the worst-case code

Hermes subprocess
  sealed IIFE bundle:
    polyfills
    + Argus framework
    + user test file
    + virtual entry calling run(<private nonce>)

Output channel
  stdout carries user logs plus exactly one framed result line:
    __ARGUS_RESULT__:<nonce>:<json>
```

## The constraint everything follows from

**Hermes cannot ask the host for modules at run time.** There is no `require`, no resolver,
no dynamic import reaching back into your project. Everything must be bundled before the VM
starts.

Three consequences, all of them good:

- **Deterministic.** What runs is a single artifact; there is no resolution to vary between
  machines.
- **Isolated per file.** No shared realm between files, so no cross-file leakage and no
  ordering coupling.
- **Trivially parallel.** Parallelism is just process parallelism, bounded by
  `--concurrency`.

And one that is a real limitation: module mocking cannot work by intercepting a registry,
because there is no registry. See [Mocks & spies](/tests/mocks/#what-is-not-here).

## The virtual entry

The bundler synthesizes an entry module rather than pointing esbuild at your test:

```ts
import "<polyfill>";
import { run } from "<framework>";
import "<your test file>";
run("<nonce>");
```

Polyfills first (Hermes has only `print` — no `console`, no `global`), then the framework
which installs the globals, then your test which registers suites, then `run`.

The nonce is inlined as a private argument in **this module's scope**. Your test modules
are separate module scopes and cannot read it. It is deliberately *not* injected as a
global `define`, which would expose it to user code and make the result frame forgeable.

## Ports and adapters

The domain in `@argus/core` is pure — no filesystem, no process, no adapter imports, not
even `node:path`. On-disk layout is expressed as path *segments* that callers join.

Four ports, four adapters:

| Port | Adapter | Responsibility |
|---|---|---|
| `Bundler` | `@argus/esbuild` | Virtual entry → sealed IIFE, syntax lowering, source map |
| `Engine` | `@argus/hermes` | Spawn `hermes` on a temp file, capture stdout |
| `Transformer` | `@argus/esbuild` | Single-file transform, same syntax policy |
| `Reporter` | `@argus/reporter-cli` | Terminal rendering, exit-code policy |

Plus `HermesProvisioner`, which turns a pin into a binary.

This is why the provisioning chain could be developed against a local binary long before
any prebuilt existed: the prebuilt adapter is a swap-in behind the port.

## Why never stdin

The Hermes adapter writes the bundle to a temp file and passes a path. It never pipes
source through stdin.

Hermes reads stdin as a **REPL**. Feeding a bundle in that way silently changes evaluation
semantics. File mode only, always.

## Bounded parallelism

`mapPool(files, concurrency, runFile)` keeps at most `concurrency` files in flight. Results
are then aggregated in **discovery order**, not completion order, so the report is stable
run to run even though execution is not.

## Where the sharp edges are

Two places in this codebase carry more invariants than their size suggests:

- **`packages/framework/src/index.ts`** — the result channel. Captured primordials, the
  framed line, the hand-written serializer. Treat as a high-integrity boundary; see
  [The result protocol](/internals/result-protocol/).
- **`packages/adapter-sourcemap`** — stack remapping, which must be **total**. A throw
  during reporting would demote a real test failure into an infrastructure failure. See
  [Source maps](/internals/source-maps/).

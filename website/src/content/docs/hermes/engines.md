---
title: Legacy and V1 engines
description: React Native pins two Hermes engines. What separates them, how Argus tells them apart, and which one your tests run on.
sidebar:
  order: 1
---

From React Native 0.83 onward there is not one Hermes, there are two.

| | Legacy Hermes | Hermes V1 (Static Hermes) |
|---|---|---|
| HBC bytecode version | **96** | **98** |
| Introduced | The original engine | RN 0.83 (pinned alongside legacy) |
| Default engine | up to RN 0.83 | **RN 0.84 onward** |
| Still available | removed in **RN 0.87** | yes |
| `class` syntax | not parsed at all | full support |
| Private fields, static blocks | no | yes |
| `async` arrow functions | no | yes |
| `for await…of`, `WeakRef` | no | yes |

Argus targets **V1 by default** and treats legacy as the compatibility mode, mirroring
where React Native itself is.

## Static Hermes did not replace the interpreter

A common misreading: "Static Hermes" sounds like an ahead-of-time compiler replacing the
VM. It is not. Static Hermes **added** an AOT native compiler *alongside* the bytecode
interpreter.

The `hermes` VM CLI target still exists on every Static Hermes ref, builds on a plain host
toolchain in roughly 95 seconds, and produces a self-contained ~4.8 MB binary. That is the
binary Argus runs.

This matters for fidelity: React Native compiles your bundle to HBC bytecode at build time
and **interprets** it on device. Same model Argus uses. A locally built `hermesc` at
`hermes-v250829098.0.16` emits bytecode byte-identical to the `hermes-compiler` npm package
React Native 0.87 ships — which is the parity gate every published prebuilt must pass.

## The delta is mostly at the parser

The gap between the engines is large in what they can *parse* and small in what they
*observe at runtime*.

V1 adds `class` in every form, private fields, static blocks, `async` arrows,
`for await…of` and `WeakRef` — none of which legacy can parse at all.

The runtime observables Argus depends on are unchanged across both:

- Microtask ordering
- Error stack shape
- Number formatting
- JSON key ordering
- Regex semantics
- Typed arrays

`Intl` is a **build flag**, not an engine difference. React Native builds with it on, so
Argus builds with it on too.

The practical consequence: the Babel class-lowering step in the bundler exists purely to
work around a legacy *parser* limitation. On V1 it is unnecessary — see
[The syntax envelope](/hermes/syntax-envelope/).

## How Argus identifies an engine

By the binary's own HBC bytecode version, not by its release version string.

Release version is unreliable: a plain clone of *any* Hermes tag reports `1.0.0`, because
`CMakeLists.txt` declares `project(Hermes VERSION 1.0.0)` and defaults
`HERMES_RELEASE_VERSION` to it. The real version has to be injected at configure time.
That is why a stock legacy build can claim `0.12.0` for what is actually `hermes-v0.17.0`.

Bytecode version is baked into the VM's format support and cannot drift. And a VM refuses
foreign bytecode outright:

```text
Wrong bytecode version. Expected 98 but got 96
```

Loud, immediate, unmistakable — never a silent degradation.

## Choosing an engine

By default Argus runs the engine your React Native version **ships by default** — the one
your app actually loads.

That is not always the newest engine your project pins. React Native 0.82 and 0.83 pin both
engines but ship legacy: V1 was an experimental opt-in there, reachable only by building
React Native from source with `hermesV1Enabled=true` (Android) or `RCT_HERMES_V1_ENABLED=1`
(iOS). V1 became the default in 0.84, and legacy was dropped in 0.87.

| React Native | Pins legacy | Pins V1 | Runs by default |
|---|---|---|---|
| 0.78 – 0.81 | yes | — | legacy |
| 0.82 | yes | opt-in | **legacy** |
| 0.83 | yes | opt-in | **legacy** |
| 0.84 – 0.86 | yes | yes | **V1** |
| 0.87 | — | yes | V1 |

Override it explicitly — this is also how you reach V1 on 0.82 or 0.83:

```bash
argus --engine v1 "src/**/*.test.ts"
argus --engine legacy "src/**/*.test.ts"
```

If your React Native release is newer than Argus knows about and pins more than one engine,
Argus cannot tell which one ships. It picks V1, and says so:

```text
⚠ Assumed the v1 engine: react-native 0.99.0 is not in Argus's engine table, and the project pins more than one Hermes engine.
```

Pass `--engine` to settle it.

Asking for an engine your project does not pin is a usage error, not a silent fallback:

```text
--engine legacy is not available: react-native 0.87.0 pins only: v1.
```

## The mismatch warning

When you name a binary yourself with `--hermes` or `ARGUS_HERMES`, Argus can no longer
guarantee it matches your project's engine. It checks anyway, and warns:

```text
⚠ Engine mismatch: this project targets v1 (bytecode 98), but the provisioned binary is
  legacy (bytecode 96).
    binary: /opt/hermes/bin/hermes
    Tests will run on that binary, so results reflect legacy, not the engine this project
    ships.
    Fix: drop --hermes/ARGUS_HERMES to provision the pinned engine, or pass --engine legacy
    if this project pins legacy too.
```

A warning, never a hard failure. Running a deliberately mismatched binary is legitimate —
bisecting an engine bug, testing a patched VM — and refusing would take that away. What is
not legitimate is doing it by accident and never being told.

A binary that reports no bytecode version at all produces no warning: absence of evidence
is not a mismatch, and warning on a guess would train you to ignore the warning.

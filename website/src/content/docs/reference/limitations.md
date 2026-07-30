---
title: Limitations & non-goals
description: What Argus does not do, split into what is coming and what is out of scope on purpose.
sidebar:
  order: 1
---

Two different lists. Confusing them wastes everyone's time.

## Not built yet

On the [roadmap](/reference/roadmap/), in priority order.

| Missing | Notes |
|---|---|
| `passWithNoTests` | A zero-match run exits 2. |
| esbuild target, module aliases, JSX runtime | Not configurable. [`argus.config.ts`](/cli/configuration/) covers globs, timeout, concurrency and engine selection; the bundler's own settings are still fixed. |
| Snapshots | `toMatchSnapshot`, `.snap` files, `--update`, obsolete pruning. Designed, not implemented. |
| Coverage | No provider, thresholds or reporters. |
| Watch mode | No file watching or re-run on change. |
| Pluggable reporters | Terminal output only. No JSON, no JUnit. |
| `bail`, `retry`, test-name filtering | Not implemented. |
| Setup files | No user-supplied global setup or teardown. |
| Windows | **Unsupported.** No prebuilt VM is published for `win32-x64`, and no source-build path is verified. Prebuilts cover `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64`. |

## Out of scope on purpose

These are not "later". They are decisions.

### Running on a device or emulator

Argus is the **standalone-VM** case. On-device runners exist and solve a different problem —
one that costs a native build and a device, and buys app-level fidelity Argus does not
claim.

Use both. Unit-level engine fidelity here; app-level behaviour there.

### Full Jest compatibility

Argus implements the surface that makes sense on Hermes, not the whole of Jest.

Notably absent, and staying absent:

- **`jest.mock('module', factory)`** and automatic module mocking. There is no module
  registry to intercept — everything is bundled before the VM starts. Inject the dependency
  instead.
- **The `jest` global.** `globalThis.jest` is `undefined`. A namespace implementing
  two-thirds of Jest is worse than none: copied code would appear to work until it reached
  the missing third.
- **Fake timers.** The standalone VM has no timers to fake.

### A React Native runtime

Argus does not provide, and is not working toward:

- Metro runtime behaviour
- Native app lifecycle
- Device APIs (`AppState`, `Dimensions`, `Linking`, `Animated`, …)
- Real UI rendering
- Layout and measurement

What exists is a native-module **shim** so code reaching for `NativeModules` or
`TurboModuleRegistry` can run and be controlled — see
[Native modules](/tests/native-modules/) — plus four host components for component tests.

### Replacing Vitest or Jest for non-RN projects

Argus exists because React Native ships on Hermes. On a project that does not, it buys
nothing that Vitest does not already do better.

### Bundling another JavaScript engine

Not JavaScriptCore, not V8, not QuickJS. The whole argument is *the engine your app ships*.

## Environment gaps to plan around

The standalone VM has no host APIs. This is the single most common source of surprise:

| Not available | What to do |
|---|---|
| `setTimeout`, `setInterval`, `setImmediate` | Inject a scheduler; see [Async tests](/tests/async/#there-are-no-timers) |
| `fetch`, `XMLHttpRequest` | Inject the transport |
| `require`, dynamic `import` | Everything is bundled up front |
| `process`, `fs`, any Node built-in | Host-only; not present in the Hermes realm |
| `window`, `document` | No DOM, by definition |

Available: `console` (built on `print`), `queueMicrotask`, `global`, `Promise`, and the
whole JavaScript language for the target engine — including `Intl`, which is built in.

## Component-testing gaps

Covered in full on [Component testing](/tests/components/#what-is-not-supported):
`waitFor`, `findBy*`, `userEvent`, fake timers, Suspense guarantees, layout, and native
platform fidelity beyond the four shim components.

Held node references stay live across an update, so a node queried once can be asserted on
and dispatched into after the tree changes. A node whose element an update removed detaches
and keeps reporting what it last rendered.

## The honest summary

Argus tells you the truth about **engine behaviour for unit-level code**. It does not tell
you your screen looks right, your navigation works, or your native module is wired up.

Those need a device. This does not pretend otherwise.

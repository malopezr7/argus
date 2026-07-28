---
title: Roadmap
description: What is done, what ships in v0.1.0, and what comes after.
sidebar:
  order: 2
---

Status: **pre-release**, working toward `v0.1.0`.

The runner works. What is missing is distribution.

## Done and verified

- Hermes-native execution: sealed IIFE per test file, spawn-per-file, nonce-framed result
  channel, hardened against forgery and prototype pollution.
- Test discovery with globs, bounded-concurrency parallel execution.
- Jest-shaped surface: `describe` / `test` / `it`, the four hooks, `.skip` / `.only` /
  `.todo`, async tests, `expect.extend`, assertion counting.
- Matcher set: equality, truthiness, numeric, string, collection, object, `toThrow`,
  `.resolves` / `.rejects`, call and return matchers.
- Source maps — failure stacks remapped to the original TypeScript.
- React Native native mocks: `NativeModules` / `TurboModuleRegistry` shims plus a
  user-facing registration API. `argus.fn()` and `argus.spyOn()`.
- Component testing on real React inside Hermes: `render`, `rerender`, `unmount`, `screen`,
  `getBy*`, `queryBy*`, `within`, `fireEvent`, `act`.
- Engine and version resolution from the project's own React Native install, with the
  offline [lookup table](/hermes/versions/) as fallback.
- The Hermes build-and-publish pipeline, gated on bytecode parity with the official
  `hermes-compiler`.
- 372 host-side unit tests, plus 15 Hermes fixtures — 6 passing, 2 intentionally failing,
  7 adversarial.

## v0.1.0 — Make it installable

The only milestone that matters right now. No new test-authoring features ship before it.

### Distribution

- Build pipeline emitting JS and `.d.ts` for every published package.
- Replace monorepo-layout path resolution with node resolution, so the CLI finds the
  framework and polyfills when installed under `node_modules`.
- A working `argus` bin entry.
- Publish flow with complete package metadata: `license`, `repository`, `description`,
  `files`, `engines`, `publishConfig.access`.
- Cut the first `hermes-bin-v*` releases so the prebuilt step stops reporting a 404.

### Engine target

- Default to V1, with V0 as an explicit opt-in target.
- Detect the project's engine and warn loudly on mismatch.
- Assert the VM's HBC bytecode version against the project's pinned `hermes-compiler` at
  startup.
- Scope the class-lowering plugin to the legacy target only.

### Provisioning

- Publish prebuilts for `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64`.
- Refresh the RN-to-Hermes lookup table in CI from the published branches table.
- Bundled-VM detection for the legacy target on RN 0.73–0.82.

### Configuration

There is no config file today. The design is settled:

```text
--config <path>
argus.config.ts
argus.config.mts
argus.config.js
argus.config.mjs
.config/argus.config.ts
package.json → "argus"
built-in defaults
```

Precedence, lowest to highest: defaults → `package.json` field → config file → environment
→ CLI flags. Loading uses native `import()`; Node type-strips `argus.config.ts` directly,
so this needs no dependency and no bundler.

- `ArgusConfig` type and documented defaults.
- Config loader and merge layer, wired through discovery, bundling and provisioning.
- `include` / `exclude` replacing the hardcoded globs.
- `passWithNoTests` — a zero-match run currently exits 2.

### Make component testing optional

Testing plain TypeScript should not require the component facade. The runtime already
behaves correctly; what remains is packaging plus one genuine design fix — React is
currently located relative to the `@argus/rntl` install directory, which makes it
structurally mandatory for any JSX.

- Optional `componentPath` in the bundler input and the CLI path resolver.
- Resolve React from the user's project, independent of `@argus/rntl`.
- Conditional alias map, with a clear diagnostic when `argus` is imported without the
  package installed.
- Regression test: bundle a pure-TypeScript suite with no React installed.

### CI

- Build on CI; run the Hermes fixtures there, not just locally.
- macOS and Linux matrix.
- Release workflow.

## v0.2.0 — Test-authoring features

Deferred until v0.1.0 ships. Valuable, but none of them block adoption.

- **Snapshots** — `toMatchSnapshot()`, external `.snap` files, `--update`, obsolete
  detection and safe pruning. Design work is complete.
- **Coverage** — provider selection, thresholds, reporters.
- **Watch mode** — file watching, re-run on change, interactive filtering. Worth splitting
  compile from execute here: `hermesc -emit-binary` to a cached `.hbc`, then `hvm` to run
  it. Measured at roughly four times faster on re-runs, because compilation dominates and
  the cache absorbs it.

## v0.3.0 and beyond

- **Reporters** — pluggable output, JSON and JUnit for CI.
- **CLI framework migration** — worth doing once a second subcommand exists (`init`,
  `watch`). Until then the built-in parser is adequate.
- **`argus init`** — scaffold a config file.
- **Windows support** — needs a prebuilt VM for `win32-x64` or a documented source-build
  path.
- **Broader React Native range** — validate and document which versions work.
- **Setup files** — user-supplied global setup and teardown.
- **`bail` / fail-fast**, **retry**, **test-name filtering**.

## Deliberate non-goals

Running on a device, full Jest compatibility, replacing Vitest for non-RN projects, and
bundling a JavaScript engine other than Hermes. Reasoning:
[Limitations & non-goals](/reference/limitations/).

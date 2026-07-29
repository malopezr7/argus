---
title: Roadmap
description: What shipped in v0.1.x and v0.2.0, what comes next, and what is deliberately deferred.
sidebar:
  order: 2
---

Status: **`v0.1.1`** — installable from npm as `@arguslab/argus`. Pre-1.0: the surface is
still free to change between minor versions.

The runner works and ships. What is missing is test-authoring surface.

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
  `hermes-compiler` — with the first release cut:
  [`hermes-bin-v250829098.0.16`](https://github.com/malopezr7/argus/releases/tag/hermes-bin-v250829098.0.16),
  V1, all four platforms, covering React Native 0.86 and 0.87.
- A [configuration file](/cli/configuration/) — `argus.config.ts` loaded through Node's own
  type stripping, so it needs no transpiler and adds no dependency.
- 875 host-side unit tests across 70 files (2 skipped), plus 15 Hermes fixtures — 6 passing,
  2 intentionally failing, 7 adversarial.

## Shipped in v0.1.0 — distribution

Argus is installable. This was the milestone everything else waited behind.

- One published package, `@arguslab/argus`, exposing the `argus` bin. The other seven
  workspace packages are private and never reach the registry — see
  [Package map](/internals/packages/).
- A build pipeline staging the tarball: host code bundled to a single ESM binary, the
  Hermes-side sources copied verbatim as TypeScript runtime assets. 30 files, 59 kB packed,
  219 kB unpacked, 276 kB installed.
- Path resolution anchored to the CLI module's own location instead of the monorepo layout,
  so the framework and polyfills are found in both the development and installed shapes.
- React resolved from the **user's project** rather than relative to the component-testing
  package. React and `test-renderer` are optional peers; a pure-TypeScript suite runs with
  neither installed.
- Complete package metadata: `license`, `repository`, `description`, `files`, `engines`
  (`node >= 24`), `publishConfig.access: public`.
- Types for the virtual `argus` module and the test globals.

That last one comes with a caveat the docs state plainly rather than glossing: it is **not**
zero-config. TypeScript only auto-loads ambient declarations from `node_modules/@types/*`,
so consumers add `"types": ["@arguslab/argus"]` or one triple-slash reference. See
[Installation → TypeScript](/start/installation/#typescript).

## Still open in the engine and provisioning work

- Scope the class-lowering plugin to the legacy target only. Today it is scoped to
  *dependencies* — `node_modules` JavaScript containing class syntax — and runs regardless
  of engine. Correct and cheap, but broader than it needs to be on V1, whose parser handles
  classes natively.
- Revisit the documented [syntax envelope](/hermes/syntax-envelope/) — it describes V0, not
  V1.
- Refresh the RN-to-Hermes lookup table in CI from the published branches table. The table
  exists and is correct; refreshing it is manual.
- Cut the remaining `hermes-bin-v*` releases. Only `hermes-bin-v250829098.0.16` is
  published, so the prebuilt step 404s on React Native 0.83–0.85 and on every legacy pin,
  falling through to `--provision`.

## Shipped in v0.2.0 — configuration

Globs, ignores, timeout, concurrency and engine selection were hardcoded or reachable only
as flags. That blocked everything below, because snapshots, coverage and watch all need
somewhere to be configured. Full reference: [Configuration](/cli/configuration/).

- `ArgusConfig` and `defineConfig` exported from the package, with documented defaults.
- Loader, validator and merge layer, wired through discovery, bundling and provisioning.
  Loading uses native `import()` — Node type-strips `argus.config.ts` directly, so this
  needed no dependency and no bundler.
- First hit wins across `argus.config.ts`, `.mts`, `.js`, `.mjs`, `.config/argus.config.ts`
  and a `package.json` field; configs are never merged, and the upward walk stops at the
  first `package.json`. `--config <path>` names one directly.
- Precedence, lowest to highest: defaults → `package.json` field → config file →
  environment → CLI flags.
- `include` / `exclude` replacing the hardcoded globs — and the hardcoded `node_modules`
  **substring** check, which had been silently skipping any directory whose name merely
  contained that string.

Two behaviour changes came with it, both covered in
[Changes in 0.2.0](/cli/configuration/#changes-in-020): discovery now excludes `dist`,
`build` and `coverage` by default, and `--timeout` rejects a value it cannot parse instead
of falling back to 10 000 ms.

Still open here:

- `passWithNoTests` — a zero-match run currently exits 2.
- esbuild target, module aliases and the JSX runtime are still fixed.

## v0.2.0 — Test-authoring features

The next milestone. None of these blocked installability; all of them are the reason
someone would ask for a v0.2.

### Snapshots, coverage, watch

- **Snapshots** — `toMatchSnapshot()`, external `.snap` files, `--update`, obsolete
  detection and safe pruning. Design work is complete.
- **Coverage** — provider selection, thresholds, reporters.
- **Watch mode** — file watching, re-run on change, interactive filtering. Worth splitting
  compile from execute here: `hermesc -emit-binary` to a cached `.hbc`, then `hvm` to run
  it. Measured at roughly four times faster on re-runs, because compilation dominates and
  the cache absorbs it.

### Component testing — the deferred half

The synchronous surface shipped. The asynchronous one did not, and the reason is structural
rather than scheduling: the standalone VM has no timers, so there is nothing for a polling
helper to wait on until Argus supplies its own clock.

- `waitFor` and `findBy*`.
- `userEvent` — the high-level interaction layer.
- Fake timers.

### CI

- Build on CI. The workflow runs typecheck, Biome and Vitest on `ubuntu-latest` only;
  `pnpm build` is not exercised.
- Run the Hermes fixtures there, not just locally. They are gated on a local binary that is
  not committed, so they skip.
- macOS and Linux matrix.

Done: the release workflow for the npm package. `@arguslab/argus` is published from CI with
signed provenance, authenticated by npm trusted publishing over OIDC so no token is stored
in the repository. `v0.1.0` predates it and was published by hand, so it carries no
attestation; `v0.1.1` and everything after does.

## v0.3.0 and beyond

- **Reporters** — pluggable output, JSON and JUnit for CI.
- **CLI framework migration** — worth doing once a second subcommand exists (`init`,
  `watch`). Until then the built-in parser is adequate.
- **`argus init`** — scaffold a config file.
- **Windows support** — needs a prebuilt VM for `win32-x64` or a documented source-build
  path. Unsupported today in any form.
- **Broader React Native range** — validate and document which versions work.
- **Setup files** — user-supplied global setup and teardown.
- **`bail` / fail-fast**, **retry**, **test-name filtering**.

## Deliberate non-goals

Running on a device, full Jest compatibility, replacing Vitest for non-RN projects, and
bundling a JavaScript engine other than Hermes. Reasoning:
[Limitations & non-goals](/reference/limitations/).

Publishing the internal packages is also a non-goal. `core`, the adapters and the reporter
are a hexagonal seam, not an API; `framework` and `rntl` are never imported by Node at all.
See [Package map](/internals/packages/).

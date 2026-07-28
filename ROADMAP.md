# Argus — Roadmap

Argus runs React Native tests on the standalone Hermes engine — the real production
VM, spawned as a subprocess. No device, no emulator, unit-test cost.

This document tracks what is done, what is next, and what is deliberately deferred.
It is the single source of truth for project direction.

Status: **pre-release**, working toward `v0.1.0`.

---

## Where we are

The runner works. What is missing is distribution.

**Done and verified**

- Hermes-native execution: sealed IIFE per test file, spawn-per-file, nonce-framed
  result channel, hardened against user-code forgery and prototype pollution.
- Test discovery with globs, bounded-concurrency parallel execution.
- Jest-compatible surface: `describe` / `test` / `it`, hooks, `.skip` / `.only` /
  `.todo`, async tests, `expect.extend`, assertion counting.
- Matcher set: equality, truthiness, numeric, object, collection, `toThrow`,
  `.resolves` / `.rejects`, call matchers.
- Source maps — failure stacks remapped to original TypeScript sources.
- React Native native mocks: `NativeModules` / `TurboModuleRegistry` shims plus a
  user-facing mock registration API. `argus.fn()` and `argus.spyOn()`.
- Component testing on real React running inside Hermes, exposed through the
  virtual `argus` module: `render`, `rerender`, `unmount`, `screen`, `getBy*`,
  `queryBy*`, `within`, `fireEvent`, `act`.
- 720 host-side unit tests, plus 15 Hermes fixtures — 6 passing, 2 intentionally
  failing, 7 adversarial.
- Engine resolution from the React Native install, a provisioning chain ending in
  prebuilt binaries published to GitHub Releases, and bytecode parity with the
  official `hermes-compiler` enforced as a CI gate on every build.

**Not done**

Argus cannot currently be installed from npm. No package emits build output, the
CLI resolves its runtime inputs through the monorepo directory layout, and no
Hermes binary reaches the user. Everything below is ordered around fixing that
first.

---

## v0.1.0 — Make it installable

The only milestone that matters right now. No new test-authoring features ship
before this one is done.

### Distribution

- [ ] Build pipeline emitting JS and `.d.ts` for every published package.
- [ ] Replace monorepo-layout path resolution with node resolution, so the CLI
      finds the framework and polyfills when installed under `node_modules`.
- [ ] Working `argus` bin entry.
- [ ] Publish flow with `pnpm publish` (the `workspace:*` protocol requires it),
      `publishConfig.access: public`, and complete package metadata:
      `license`, `repository`, `description`, `files`, `engines`.
- [ ] LICENSE at the repo root.

### Engine target: Hermes V1 by default

React Native 0.84 made Hermes V1 (Static Hermes) the default engine. RN 0.87
drops the legacy engine entirely. Legacy is now the compatibility mode, not the
mainline — Argus targets V1 by default and treats V0 as opt-in.

Static Hermes did not replace the bytecode interpreter; it added an AOT native
compiler alongside it. The `hermes` VM CLI target still exists on every Static
Hermes ref, builds on a plain host toolchain in about 95 seconds, and produces a
self-contained 4.8 MB binary.

Fidelity is exact, not approximate. React Native compiles the bundle to HBC
bytecode at build time and interprets it on device — the same model Argus uses.
A locally built `hermesc` at tag `hermes-v250829098.0.16` emits bytecode
byte-identical to the `hermes-compiler` npm package RN 0.87 ships. Bytecode
version mismatches fail loudly rather than degrading silently.

The V0 to V1 delta is large at the parser level and small at the runtime level.
V1 adds `class` in every form, private fields, static blocks, async arrow
functions, `for await…of` and `WeakRef` — none of which V0 can parse. Runtime
observables Argus depends on are unchanged: microtask ordering, error stack
shape, number formatting, JSON key ordering, regex semantics, typed arrays.

`Intl` is a build flag, not an engine difference. React Native builds with it on,
so Argus does too.

Consequence: the Babel class-lowering plugin in `@argus/esbuild` exists only to
work around a V0 parser limitation. On V1 it is unnecessary. It stays as part of
the legacy compatibility target, which the adapter layer already models.

- [ ] Default to V1; expose V0 as an explicit opt-in target.
- [ ] Detect the project's engine and warn loudly on mismatch.
- [ ] Assert the VM's HBC bytecode version against the project's pinned
      `hermes-compiler` at startup.
- [ ] Scope the class-lowering plugin to the legacy target only.
- [ ] Revisit the documented Hermes syntax envelope — it describes V0, not V1.

### Hermes provisioning

Upstream stopped publishing standalone VM binaries as GitHub release assets in
August 2024 at `v0.13.0`. Tags keep flowing but carry no assets, and modern CI
builds the VM only for macOS. Building from source is cheap and exact, so Argus
builds its own and publishes them.

Version resolution uses two sources. The React Native branches table at
`reactnative.dev/releases/branches` gives the canonical RN branch to Hermes
mapping for both engines, and is the reference for generating our lookup table in
CI. The user's own project is authoritative at runtime:

1. `sdks/hermes-engine/version.properties` (RN 0.82+)
2. `sdks/.hermesv1version` (RN 0.83+)
3. `sdks/.hermesversion` (RN 0.69+)
4. `package.json` → `dependencies["hermes-compiler"]` (RN 0.83+)

Tag schemes differ — date-based (`hermes-2025-07-24-RNv0.80.2-<sha>`) up to RN
0.82, semver (`hermes-v0.17.0`, `hermes-v250829098.0.16`) from RN 0.83. Both must
parse. The tag does not track the RN patch version; read the file and treat its
contents as opaque.

Several React Native versions share a Hermes tag, so the number of binaries to
build is well below the number of RN releases.

Resolution order for the binary itself:

1. **Cache** — `~/.argus/cache/hermes-<tag>/build/bin/hermes`.
2. **Argus prebuilt** — a GitHub Release on this repository, tagged
   `hermes-bin-v<hermes version>` and carrying one gzipped tar per platform
   (`hermes-<version>-<os>-<cpu>.tar.gz`) plus per-asset and aggregate
   checksums. Built and published by our CI, and versioned by the Hermes
   version rather than the Argus version. Fetched at run time, never declared
   as a dependency: RN 0.83 wants Hermes `250829098.0.4` and RN 0.86 wants
   `250829098.0.16` with the same Argus installed, and a dependency fixed at
   publish time cannot express that. This is where Argus differs from the
   esbuild model, which pins one binary per esbuild release because it only
   ever needs one.

   Releases rather than npm because the constraint is run-time resolution, and
   npm's job is to install a version chosen at publish time. A release on a
   public repository needs no authentication to download, has no practical size
   limit, and is CDN-served. npm stays reserved for the Argus code packages,
   which is a separate concern. The download verifies the published SHA-256
   before it trusts an archive, and extracts through a temporary directory so an
   interrupted run cannot leave a half-populated cache entry behind.
3. **Bundled legacy VM** — `node_modules/react-native/sdks/hermesc/osx-bin/hermes`.
   Present for RN 0.73 through 0.82 on macOS, universal binary. Free and exact,
   but legacy-only; use it when the project targets V0.
4. **Source build** — opt-in, never silent. Requires cmake and ninja.
5. **Explicit** — `ARGUS_HERMES` / `--hermes`, always honoured.

Every resolved binary is smoke-tested and its bytecode version checked before
caching.

Build configuration mirrors React Native's own:

```
-DCMAKE_BUILD_TYPE=Release
-DHERMES_ENABLE_INTL=ON
-DHERMES_ENABLE_DEBUGGER=ON
-DHERMES_ENABLE_TEST_SUITE=OFF
-DCMAKE_OSX_ARCHITECTURES="x86_64;arm64"
--target hermes hermesc hvm
```

- [ ] Version resolver reading the four project files above.
- [ ] Generated RN-to-Hermes lookup table, refreshed in CI from the branches
      table.
- [x] Fix the `.hermesv1version` filename casing — the previous lookup used a
      capital `V` and silently fell through to the legacy file on
      case-sensitive filesystems.
- [x] Publish prebuilts for `darwin-arm64`, `darwin-x64`, `linux-x64` and
      `linux-arm64`, built by `.github/workflows/hermes-prebuilt.yml` on manual
      dispatch, gated on bytecode parity with the official `hermes-compiler`,
      and attached to a GitHub Release with checksums and signed build
      provenance. Windows stays out until there is a verified toolchain for it.
- [x] Set the engine release version explicitly at build time — a raw clone
      reports `1.0.0`.
- [x] Bundled-VM detection for the legacy target on RN 0.73–0.82.
- [ ] Wire the full fallback chain and remove the hardcoded
      `{ rnVersion, os, arch }` target from the CLI composition root.

### Configuration

There is no config file today. Test globs, ignore patterns, timeout, concurrency,
esbuild target, module aliases, and the JSX runtime are all hardcoded.

Config resolution, first match wins:

```
--config <path>
argus.config.ts
argus.config.mts
argus.config.js
argus.config.mjs
.config/argus.config.ts
package.json → "argus"
built-in defaults
```

Precedence, lowest to highest: defaults → `package.json` field → config file →
environment → CLI flags.

Loading uses native `import()`. Node type-strips `argus.config.ts` directly, so
this needs no dependency and no bundler. `defineConfig` is an identity function
exported for the type hint.

- [ ] `ArgusConfig` type and documented defaults in `@argus/core`.
- [ ] Config loader and merge layer.
- [ ] Wire config through discovery, bundling, and provisioning.
- [ ] `include` / `exclude` replacing the hardcoded globs and the single
      hardcoded `node_modules` substring check.
- [ ] `passWithNoTests` — a zero-match run currently exits 2.

### Make `@argus/rntl` optional

Component testing is an add-on, not part of the runner. Testing plain TypeScript
or plain React should not require it.

The runtime already behaves correctly — a pure-TypeScript test bundles
identically whether or not the component facade resolves, because aliases are
lazy. What remains is contract and packaging work, plus one genuine design fix:
React is currently located relative to the `@argus/rntl` install directory, which
makes it structurally mandatory for any JSX.

- [ ] `componentPath` optional in `BundleInput` and in the CLI path resolver.
- [ ] Resolve React from the user's project, independent of `@argus/rntl`.
- [ ] Conditional alias map; clear diagnostic when `argus` is imported without
      the package installed.
- [ ] Export the lifecycle registry from `@argus/framework` so `@argus/rntl`
      depends on the package rather than a relative cross-package path.
- [ ] Drop `private: true` from `@argus/rntl`.
- [ ] Remove the React type mapping that points `@argus/framework` at
      `@argus/rntl`'s `node_modules`.
- [ ] Regression test: bundle a pure-TypeScript suite with no React installed.

### Documentation

- [ ] Consumer-facing README: install, quick start, configuration.
- [ ] API reference — matchers, mocks, component queries, CLI flags.
- [ ] Documented limitations and the supported React Native range.

### CI

- [ ] Build on CI.
- [ ] Run Hermes fixtures on CI, not just locally.
- [ ] macOS and Linux matrix.
- [ ] Release workflow.

---

## v0.2.0 — Test-authoring features

Deferred until v0.1.0 ships. These are valuable but none of them block adoption.

- [ ] **Snapshots** — `toMatchSnapshot()`, external `.snap` files, `--update`,
      obsolete detection and safe pruning. Design work is complete.
- [ ] **Coverage** — provider selection, thresholds, reporters.
- [ ] **Watch mode** — file watching, re-run on change, interactive filtering via
      raw keypress handling. Worth splitting compile from execute here:
      `hermesc -emit-binary` to a cached `.hbc`, then `hvm` to run it. Measured
      at roughly four times faster on re-runs of a realistic bundle, because
      compilation dominates and the cache absorbs it.

---

## v0.3.0 and beyond

- [ ] **Reporters** — pluggable output, JSON and JUnit for CI consumption.
- [ ] **CLI framework migration** — worth doing once a second subcommand exists
      (`init`, `watch`). Until then the built-in argument parser is adequate.
- [ ] **`argus init`** — scaffold a config file with sensible defaults.
- [ ] **Windows support** — requires either our own prebuilt VM for `win32-x64`
      or a documented source-build path.
- [ ] **Broader React Native range** — validate and document which versions work.
- [ ] **Setup files** — user-supplied global setup and teardown.
- [ ] **`bail` / fail-fast**, **retry**, **test name filtering**.

---

## Deliberate non-goals

- Running on a device or emulator. Argus is the standalone-VM case; on-device
  runners already exist and solve a different problem.
- Full Jest API compatibility. We implement the surface that makes sense on
  Hermes, not the whole of Jest.
- Replacing Vitest or Jest for non-React-Native projects. Argus exists because
  React Native ships on Hermes.
- Bundling a JavaScript engine other than Hermes.

---

## Dependency policy

`@argus/cli` and `@argus/reporter-cli` currently have zero external runtime
dependencies. That is intentional. For a tool whose pitch is engine fidelity at
unit-test cost, a small install is part of the argument.

Node's built-ins cover more than they used to — `util.styleText` for colour with
correct `NO_COLOR` and `FORCE_COLOR` handling, `fs.promises.glob` for discovery,
native TypeScript stripping for config loading. Prefer them.

Every added dependency needs a reason that a built-in cannot satisfy.

# Argus — Roadmap

Argus runs React Native tests on the standalone Hermes engine — the real production
VM, spawned as a subprocess. No device, no emulator, unit-test cost.

This document tracks what is done, what is next, and what is deliberately deferred.
It is the single source of truth for project direction.

Status: **`v0.2.0`** — installable from npm as
[`@arguslab/argus`](https://www.npmjs.com/package/@arguslab/argus). Pre-1.0: the
surface is still free to change between minor versions.

---

## Where we are

The runner works and ships. What is missing is test-authoring surface.

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
- Configuration file — `argus.config.ts` loaded through Node's own type stripping,
  with a validator, a documented precedence order, and zero added dependencies.
  See below.
- 875 host-side unit tests across 70 files (2 skipped), plus 15 Hermes fixtures —
  6 passing, 2 intentionally failing, 7 adversarial.
- Engine resolution from the React Native install, a provisioning chain ending in
  prebuilt binaries published to GitHub Releases, and bytecode parity with the
  official `hermes-compiler` enforced as a CI gate on every build.
- **Distribution** — see below.

### Configuration — shipped in v0.2.0

Globs, ignores, timeout, concurrency and engine selection were hardcoded or
reachable only as flags. That blocked everything in v0.2.0, because snapshots,
coverage and watch all need somewhere to be configured.

Config resolution, first match wins and configs are never merged:

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

The search walks upward from the working directory and stops at the first
`package.json`, so a stray config in a home directory or a sibling checkout can
never govern a project's test run.

Precedence, lowest to highest: defaults → `package.json` field → config file →
environment → CLI flags.

Loading uses native `import()`. Node type-strips `argus.config.ts` directly, so
this needed no dependency and no bundler. `defineConfig` is an identity function
exported for the type hint, from an entry point that carries no value imports at
all — importing config types must not drag in the runner, esbuild or Babel, and
the build fails if that stops being true.

- [x] `ArgusConfig` type and documented defaults in `@arguslab/core`.
- [x] Config loader, validator and merge layer. Values are validated and never
      coerced; every problem in a config is reported in one pass, and a config
      that cannot be used exits 2 rather than falling back to the defaults.
- [x] Wire config through discovery, bundling, and provisioning.
- [x] `include` / `exclude` replacing the hardcoded globs and the single
      hardcoded `node_modules` substring check — which had been silently
      skipping any directory whose name merely *contained* that string, such as
      `my-node_modules-fixtures/`, and reporting its tests as a pass.
- [x] A real importable entry (`@arguslab/argus`) so a config file can import
      `defineConfig` for its types.
- [ ] `passWithNoTests` — a zero-match run currently exits 2.
- [ ] esbuild target, module aliases and the JSX runtime are still fixed.

Two behaviour changes shipped with it, both documented at
[Configuration → Changes in 0.2.0](https://argus-hermes.pages.dev/cli/configuration/#changes-in-020):
discovery now excludes `dist`, `build` and `coverage` by default, and `--timeout`
rejects a value it cannot parse instead of silently running with 10 000 ms.

### Distribution — shipped in v0.1.0

- [x] One published package, `@arguslab/argus`, exposing the `argus` bin. The other
      seven workspace packages are `private: true` and never reach the registry.
- [x] Build pipeline (`pnpm build` → `scripts/build-package.ts`) staging `dist/`:
      the host side bundled to a single ESM binary, the Hermes-side sources copied
      verbatim as TypeScript runtime assets. 30 files, 59 kB packed, 219 kB
      unpacked, 276 kB installed.
- [x] Replace monorepo-layout path resolution with a probe anchored to the module's
      own location, so the CLI finds the framework and polyfills in both the
      development and installed layouts (`packages/cli/src/paths.ts`).
- [x] Resolve React from the **user's project** rather than relative to the
      component-testing package (`packages/adapter-esbuild/src/project-packages.ts`).
      React and `test-renderer` are optional peers; a pure-TypeScript suite runs
      with neither installed.
- [x] Complete package metadata: `license`, `repository`, `description`, `files`,
      `engines` (`node >= 24`), `publishConfig.access: public`.
- [x] LICENSE at the repo root.
- [x] Ship types for the virtual `argus` module and the test globals.

Note on the last one: this is **not** zero-config, and the docs say so. TypeScript
only auto-loads ambient declarations from `node_modules/@types/*`, and Argus is not
published under that scope. Consumers add `"types": ["@arguslab/argus"]` to their
tsconfig, or one `/// <reference types="@arguslab/argus" />`. Both are verified.

### Engine target: Hermes V1 by default — shipped

React Native 0.84 made Hermes V1 (Static Hermes) the default engine. RN 0.87
drops the legacy engine entirely. Legacy is now the compatibility mode, not the
mainline — Argus targets V1 by default and treats V0 as opt-in.

Fidelity is exact, not approximate. React Native compiles the bundle to HBC
bytecode at build time and interprets it on device — the same model Argus uses.
A locally built `hermesc` at tag `hermes-v250829098.0.16` emits bytecode
byte-identical to the `hermes-compiler` npm package RN 0.87 ships. Bytecode
version mismatches fail loudly rather than degrading silently.

- [x] Default to V1; expose V0 as an explicit opt-in target (`--engine`).
- [x] Detect the project's engine and warn loudly on mismatch.
- [x] Assert the VM's HBC bytecode version against the project's pinned engine.
- [ ] Scope the class-lowering plugin to the legacy target only. Today it is scoped
      to *dependencies* — `node_modules` JavaScript containing class syntax — and
      runs regardless of engine. Correct and cheap, but broader than it needs to be
      on V1, where the parser handles classes natively.
- [ ] Revisit the documented Hermes syntax envelope — it describes V0, not V1.

### Hermes provisioning — shipped

Upstream stopped publishing standalone VM binaries as GitHub release assets in
August 2024 at `v0.13.0`. Tags keep flowing but carry no assets, and modern CI
builds the VM only for macOS. Building from source is cheap and exact, so Argus
builds its own and publishes them.

Resolution order for the binary:

1. **Explicit** — `ARGUS_HERMES` / `--hermes`, always honoured, never probed.
2. **Project-vendored** — `./.hermes/hermes`.
3. **Cache** — `~/.argus/cache/hermes-<tag>/build/bin/hermes`.
4. **Bundled legacy VM** — `node_modules/react-native/sdks/hermesc/osx-bin/hermes`,
   RN 0.73–0.82 on macOS, legacy only.
5. **Argus prebuilt** — a GitHub Release tagged `hermes-bin-v<hermes version>`,
   one gzipped tar per platform plus per-asset and aggregate checksums. Fetched at
   run time, never declared as a dependency: RN 0.83 wants Hermes `250829098.0.4`
   and RN 0.86 wants `250829098.0.16` with the same Argus installed, and a
   dependency fixed at publish time cannot express that.
6. **Source build** — opt-in behind `--provision`, never silent. Needs cmake and ninja.

Every resolved binary is smoke-tested and its bytecode version checked before
caching. Measured on a clean project: 3.6 s for the first run including the
download, 1.3 s for the second, settling at 0.62 s once warm.

- [x] Version resolver reading `version.properties`, `.hermesv1version`,
      `.hermesversion` and the `hermes-compiler` dependency.
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
- [x] Wire the full fallback chain and remove the hardcoded
      `{ rnVersion, os, arch }` target from the CLI composition root.
- [ ] Generated RN-to-Hermes lookup table, refreshed in CI from the published
      branches table. The table exists and is correct; refreshing it is manual.
- [ ] Cut the remaining `hermes-bin-v*` releases. Only
      `hermes-bin-v250829098.0.16` is published, so the prebuilt step 404s on
      RN 0.83–0.85 and on every legacy pin, falling through to `--provision`.

---

## v0.2.0 — Test-authoring features

The next milestone. None of these blocked installability; all of them are the
reason someone would ask for a v0.2.

### Snapshots, coverage, watch

- [ ] **Snapshots** — `toMatchSnapshot()`, external `.snap` files, `--update`,
      obsolete detection and safe pruning. Design work is complete.
- [ ] **Coverage** — provider selection, thresholds, reporters.
- [ ] **Watch mode** — file watching, re-run on change, interactive filtering via
      raw keypress handling. Worth splitting compile from execute here:
      `hermesc -emit-binary` to a cached `.hbc`, then `hvm` to run it. Measured
      at roughly four times faster on re-runs of a realistic bundle, because
      compilation dominates and the cache absorbs it.

### Component testing — the deferred half

The synchronous surface shipped. The asynchronous one did not, and the reason is
structural rather than scheduling: the standalone VM has no timers, so there is
nothing for a polling helper to wait on until Argus supplies its own clock.

- [ ] `waitFor` and `findBy*`.
- [ ] `userEvent` — the high-level interaction layer.
- [ ] Fake timers.

### CI

- [ ] Build on CI. `ci.yml` runs typecheck, Biome and Vitest on `ubuntu-latest`
      only; `pnpm build` is not exercised.
- [ ] Run the Hermes fixtures on CI, not just locally. They are gated on a local
      binary that is not committed, so they skip.
- [ ] macOS and Linux matrix.
- [x] Release workflow for the npm package. `npm-publish.yml` publishes
      `@arguslab/argus` from CI with signed provenance, authenticated by npm
      trusted publishing over OIDC so no token is stored in the repository.
      `v0.1.0` predates it and was published by hand, so it carries no
      attestation; `v0.1.1` was the first release to ship one, and everything
      after it does too.

---

## v0.3.0 and beyond

- [ ] **Reporters** — pluggable output, JSON and JUnit for CI consumption.
- [ ] **CLI framework migration** — worth doing once a second subcommand exists
      (`init`, `watch`). Until then the built-in argument parser is adequate.
- [ ] **`argus init`** — scaffold a config file with sensible defaults.
- [ ] **Windows support** — requires either our own prebuilt VM for `win32-x64`
      or a documented source-build path. Not supported today in any form.
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
- Publishing the internal packages. `core`, the adapters and the reporter are a
  hexagonal seam, not an API; `framework` and `rntl` are never imported by Node
  at all — they ship as TypeScript runtime assets and are compiled by esbuild on
  the user's machine. The split is entirely intact in the source tree; it simply
  does not require eight registry entries.

---

## Dependency policy

`@arguslab/cli` and `@arguslab/reporter-cli` have zero external runtime
dependencies. That is intentional. For a tool whose pitch is engine fidelity at
unit-test cost, a small install is part of the argument.

The published package declares four: `esbuild`, `@babel/core`,
`@babel/plugin-transform-classes` and `source-map`. Each resists inlining for a
concrete reason — esbuild ships a platform-specific native binary, Babel resolves
plugins dynamically, and `source-map` loads a WASM file.

Node's built-ins cover more than they used to — `util.styleText` for colour with
correct `NO_COLOR` and `FORCE_COLOR` handling, `fs.promises.glob` for discovery,
native TypeScript stripping for config loading. Prefer them.

Every added dependency needs a reason that a built-in cannot satisfy.

---
title: How the binary is provisioned
description: The six-step chain that turns your project's Hermes pin into an executable on this machine.
sidebar:
  order: 3
---

Provisioning answers one question: *where does the `hermes` binary come from?*

Six sources, walked in order, **most explicit first** — anything you put there outranks
anything Argus produced.

## The chain

| # | Source | Where | Cost |
|---|---|---|---|
| 1 | **explicit** | `--hermes <path>` / `ARGUS_HERMES` | none |
| 2 | **project-vendored** | `./.hermes/hermes` | none |
| 3 | **cache** | `~/.argus/cache/hermes-<tag>/build/bin/hermes` | none |
| 4 | **bundled-legacy** | `node_modules/react-native/sdks/hermesc/osx-bin/hermes` | none |
| 5 | **prebuilt** | an Argus GitHub Release | one download |
| 6 | **source-build** | built from `facebook/hermes` | minutes, opt-in |

### 1. Explicit

```bash
argus --hermes /opt/hermes/bin/hermes "src/**/*.test.ts"
ARGUS_HERMES=/opt/hermes/bin/hermes argus "src/**/*.test.ts"
```

An explicit path is **not probed** before being selected. If you named a path, you are
entitled to an error about *that* path rather than a silent fallback onto some other
binary. A bad `--hermes` fails with its own message instead of quietly running different
code than you asked for.

### 2. Project-vendored

Drop a binary at `./.hermes/hermes` in the project and it is used with no flag and no
environment variable. A zero-config convention for "this repo has its own VM".

Unlike an explicit path this one *is* probed — its absence is the normal case, so falling
through is correct rather than an error.

### 3. Cache

```text
~/.argus/cache/hermes-<tag>/build/bin/hermes
```

The tag is the directory name verbatim, so two engines pinned by the same project cache
side by side. An existence check only — nothing is rebuilt here, because a slow
network-bound side effect should never happen without you asking.

### 4. The VM bundled with React Native

Present in the `react-native` tarball for **RN 0.73–0.82**, macOS only, universal Mach-O.
Free, exact for your patch version, and already on disk — the best legacy source available
when it applies.

It is skipped, with a specific reason, when any precondition fails: project targets V1, no
React Native install found, host is not macOS, or the file is missing.

:::note
The sibling `hermesc` in that directory is the **compiler**, not the VM. The VM is the file
named exactly `hermes`.
:::

### 5. Prebuilt

A GitHub Release on `malopezr7/argus`, tagged `hermes-bin-v<version>`, carrying one gzipped
tar per platform. Downloaded, checksum-verified, extracted into the cache.

Applies only when a matching asset *could* exist: there is a ref, the ref can name a
release version, and your host is a published platform. Each miss reports its own reason
rather than a blanket "unavailable". See [Prebuilt binaries](/hermes/prebuilts/).

### 6. Source build

Never silent. It happens only with `--provision`:

```bash
argus --provision "src/**/*.test.ts"
```

Clones `facebook/hermes` at the pinned tag and builds with the configuration React Native
uses for its own builds:

```bash
cmake -S <src> -B <build> -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DHERMES_ENABLE_INTL=ON \
  -DHERMES_ENABLE_DEBUGGER=ON \
  -DHERMES_ENABLE_TEST_SUITE=OFF \
  -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" \
  -DHERMES_RELEASE_VERSION=<version>

cmake --build <build> --target hermes hermesc hvm -j <n>
```

Why each flag matters:

- **`HERMES_ENABLE_INTL=ON`** — `Intl` is a build flag, not an engine capability. A VM
  built without it silently lacks `Intl` while the engine your app ships has it. That is
  precisely the fidelity gap Argus exists to close.
- **`HERMES_ENABLE_DEBUGGER=ON`** — matches React Native's own builds.
- **`HERMES_ENABLE_TEST_SUITE=OFF`** — Hermes' own test suite is not ours to build, and it
  is the single biggest cost in a default configure.
- **`CMAKE_OSX_ARCHITECTURES`** — universal binary on macOS, as RN does. Omitted elsewhere.
- **`HERMES_RELEASE_VERSION`** — without it a clone of *any* tag reports `1.0.0`. Injecting
  the real version is what makes `--version` output true instead of fiction. It is omitted
  for a bare commit SHA, which is a git ref and not a version — baking one in would make
  the binary misreport itself.

`hermesc` and `hvm` are built alongside `hermes` because compiling once to bytecode and
running that is several times faster on re-runs. Argus does not take that path yet; the
binaries have to exist before it can.

## Verification

Every resolved binary — no matter which source produced it — is smoke-tested and its
bytecode version read before it is cached or used. A downloaded archive has its published
SHA-256 verified before it is trusted, and extraction goes through a temporary directory so
an interrupted run cannot leave a half-populated cache entry behind.

## When nothing works

Argus never prompts. A test runner mostly runs in CI, where a prompt is a hang. Instead it
prints what it was looking for, everywhere it looked, and what to type next:

```text
✗ INFRASTRUCTURE FAILURE [provision] No Hermes binary available.
  Engine: v1 hermes-v250829098.0.16 (pinned by version.properties, react-native 0.86.2)
  Tried:
    project-vendored  /work/app/.hermes/hermes — not present
    cache             ~/.argus/cache/hermes-hermes-v250829098.0.16/build/bin/hermes — no cached build
    bundled-legacy    only ships the legacy VM, but v1 is targeted
    prebuilt          no prebuilt is published for win32-x64
    source-build      not authorised — pass --provision
  Fix it with one of:
    argus --provision [globs...]   build Hermes v1 hermes-v250829098.0.16 from source (needs git, cmake, ninja)
    argus --hermes <path> [globs...]   use a Hermes binary you already have
    ARGUS_HERMES=<path> argus [globs...]   the same, via the environment
    vendor a binary at ./.hermes/hermes to have it picked up with no flag
```

## The success line

One line, so it survives in a CI log:

```text
✓ hermes v1 hermes-v250829098.0.16 · prebuilt darwin-arm64 · /Users/you/.argus/cache/…/hermes
```

Engine · ref · which source supplied it · the actual path. When your project pins nothing,
the engine is inferred from the binary's own bytecode version and marked `(detected)`, so
"the project told us" and "we guessed from the binary" are never confused.

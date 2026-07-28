---
title: React Native version table
description: Which Hermes engine and version each React Native release pins, and where Argus gets a binary for it.
sidebar:
  order: 2
---

React Native pins a specific Hermes ref per release branch. Argus reads that pin from
**your** install — this table is the offline fallback, and the reference for what to expect.

Source of truth: [reactnative.dev/releases/branches](https://reactnative.dev/releases/branches).

## The table

| React Native | Legacy pin | V1 pin | RN default engine | Prebuilt |
|---|---|---|---|---|
| **0.87** | *removed* | `hermes-v250829098.0.16` | V1 | **V1 published** |
| **0.86** | `hermes-v0.17.0` | `hermes-v250829098.0.16` | V1 | **V1 published**, legacy publishable |
| **0.85** | `hermes-v0.16.0` | `hermes-v250829098.0.10` | V1 | both publishable |
| **0.84** | `hermes-v0.15.1` | `hermes-v250829098.0.9` | V1 | both publishable |
| **0.83** | `hermes-v0.14.1` | `hermes-v250829098.0.4` | legacy | both publishable |
| **0.82** | `hermes-2025-09-01-RNv0.82.0` | `76dc3793` | legacy | neither |
| **0.81** | `hermes-2025-07-07-RNv0.81.0` | — | legacy | no |
| **0.80** | `hermes-2025-07-24-RNv0.80.2` | — | legacy | no |
| **0.79** | `hermes-2025-06-04-RNv0.79.3` | — | legacy | no |
| **0.78** | `hermes-2025-01-13-RNv0.78.0` | — | legacy | no |

Only the `major.minor` part of your React Native version is used as the key: `0.86.2` and
`0.86.0` resolve identically.

**Published** means a release exists and Argus can download it right now. **Publishable**
means the ref can name a release version, so the pipeline can cut one — it just has not
been cut yet, and the chain falls through to the bundled VM or `--provision` in the
meantime. See [Prebuilt binaries](/hermes/prebuilts/).

### Why some rows have no prebuilt

A published release has to be **named** by a version, and not every Hermes ref can name
one. Date-based refs (`2025-09-01-RNv0.82.0`) and bare commit SHAs (`76dc3793`, how RN 0.82
pins its V1 engine) are git refs, not versions — there is nothing to tag a release
`hermes-bin-v<what>` with.

On those React Native versions, Argus falls back to:

1. **The VM bundled inside React Native** — `sdks/hermesc/osx-bin/hermes`, shipped in the
   `react-native` tarball for **RN 0.73 through 0.82**, macOS only, universal binary. Free,
   already on disk, and an exact match for your patch version. This is the good path.
2. **A source build** — `argus --provision`, on any platform. Needs `git`, `cmake` and
   `ninja`.

### Older than 0.78

The table stops at 0.78, but Argus does not. The table is only the *fallback*; your own
install is authoritative, and `sdks/.hermesversion` has existed since **RN 0.69**. On RN
0.73–0.77 the bundled macOS VM is present too, so those versions generally work without
building anything.

An out-of-table React Native is a resolution miss, not an error — Argus falls through to
whatever the next provisioning source can supply.

## When both engines are pinned

Argus prefers **V1** when your project pins both, regardless of which one React Native
treats as its default. On RN 0.83 that means Argus targets V1 while an RN build defaults to
legacy.

If you ship legacy on 0.83, say so:

```bash
argus --engine legacy "src/**/*.test.ts"
```

Or check what your build actually uses — RN reads the same pins, and
[the mismatch warning](/hermes/engines/#the-mismatch-warning) tells you when a binary
disagrees with the target.

## Where your pin is read from

In precedence order. A source only fills engine slots still empty, so
`version.properties` can pin both engines at once and later files fill only the gaps.

| # | Source | Available since |
|---|---|---|
| 1 | `node_modules/react-native/sdks/hermes-engine/version.properties` | RN 0.82 |
| 2 | `node_modules/react-native/sdks/.hermesv1version` | RN 0.83 |
| 3 | `node_modules/react-native/sdks/.hermesversion` | RN 0.69 |
| 4 | `node_modules/react-native/package.json` → `dependencies['hermes-compiler']` | RN 0.83 |
| 5 | The table above | fallback only |

`version.properties` is a Java properties file with `HERMES_VERSION_NAME` and
`HERMES_V1_VERSION_NAME` keys. The other two are single-line files.

The search walks upward from the working directory to find `node_modules/react-native`, so
running Argus from a package inside a monorepo finds the hoisted install.

## Tags are opaque

Two tag schemes exist and both parse:

- **Date-based**, RN 0.69–0.82: `hermes-2025-07-24-RNv0.80.2-<sha>`
- **Semver**, RN 0.83+: `hermes-v0.17.0`, `hermes-v250829098.0.16`

A date-based tag *contains* an RN version, and it is **not your RN version**.
`react-native@0.72.17` ships a tag reading `RNv0.72.14`. Never parse an RN version back out
of a Hermes tag — read the file and treat its contents as opaque. Argus does.

Also note how many React Native releases share a Hermes pin: 0.86 and 0.87 both want
`250829098.0.16`. The number of binaries to build is well below the number of RN releases.

## Keeping this table current

The table is raw string data on purpose — one row per RN minor, diffable against the
published branches table, refreshable in CI as a data-only edit. Adding a new React Native
release is one line.

---
title: Prebuilt binaries
description: Why Hermes binaries ship as GitHub Releases instead of npm packages, what each release contains, and how to verify one.
sidebar:
  order: 4
---

Upstream stopped publishing standalone Hermes VM binaries as GitHub release assets in
August 2024, at `v0.13.0`. Tags keep flowing but carry no assets, and modern upstream CI
builds the VM for macOS only.

Building from source is cheap and exact, so Argus builds its own and publishes them.

## Published platforms

| Platform | Asset |
|---|---|
| `darwin-arm64` | `hermes-<version>-darwin-arm64.tar.gz` |
| `darwin-x64` | `hermes-<version>-darwin-x64.tar.gz` |
| `linux-x64` | `hermes-<version>-linux-x64.tar.gz` |
| `linux-arm64` | `hermes-<version>-linux-arm64.tar.gz` |

Windows is absent deliberately — it needs a different toolchain and a different binary
layout (`.exe`, bundled ICU DLLs), and no part of Argus is verified on it yet. On Windows,
use `--provision` or name a binary with `--hermes`.

Each archive holds three executables:

| File | What it is |
|---|---|
| `hermes` | The VM. Runs JavaScript or compiled bytecode. |
| `hermesc` | The compiler. Emits HBC bytecode. |
| `hvm` | The bytecode-only VM. |

## Releases, not npm

The releases are tagged `hermes-bin-v<hermes version>` — versioned by the **Hermes**
version, not the Argus version. No Argus package depends on them.

That is the whole point. npm versions a package once, at publish time. Which Hermes binary
you need depends on **your** project: React Native 0.83 wants `250829098.0.4` and 0.86
wants `250829098.0.16`, with the same Argus installed for both. A dependency fixed at
publish time cannot express that.

This is where Argus differs from the esbuild model, which pins one binary per esbuild
release — esbuild only ever needs one.

A release on a public repository also needs no authentication to download, has no practical
size limit, and is CDN-served. npm stays reserved for the Argus code packages, which is a
separate concern.

The `hermes-bin-v` prefix keeps the two tag namespaces separable: Argus tags its own
releases `v0.1.0`, and both live on the same repository. A hyphen rather than a slash keeps
the tag usable verbatim in an asset URL path.

## Verifying

Every asset ships a `.sha256` next to it, and `checksums.txt` covers the whole release:

```bash
shasum -a 256 -c checksums.txt
```

The two are redundant by design: the aggregate is what a human verifies the whole release
with in one command; the per-asset file is what the provisioning chain fetches when it
wants exactly one archive and should not pay for the others.

Argus verifies the checksum on download **before** it trusts an archive, and extracts
through a temporary directory so an interrupted run cannot leave a half-populated cache
entry behind.

## The parity gate

Every published build is gated on bytecode parity with the official compiler React Native
ships: the same source compiled by our `hermesc` and by `hermes-compiler@<version>` must
produce a **byte-identical** `.hbc`.

That is what makes "the same engine" a checkable claim rather than a marketing line. A
build that fails the gate is not published.

## Downloading by hand

You do not need to. Argus fetches the right one at run time and caches it under
`~/.argus/cache/`.

If you want one anyway — an air-gapped machine, a container image, a shared CI cache:

```bash
curl -LO https://github.com/malopezr7/argus/releases/download/hermes-bin-v250829098.0.16/hermes-250829098.0.16-linux-x64.tar.gz
curl -LO https://github.com/malopezr7/argus/releases/download/hermes-bin-v250829098.0.16/checksums.txt
shasum -a 256 -c checksums.txt --ignore-missing

tar xzf hermes-250829098.0.16-linux-x64.tar.gz
argus --hermes ./hermes "src/**/*.test.ts"
```

The asset name carries the version as well as the platform even though the release tag
already pins it — assets get downloaded, renamed by browsers, and pasted into issue reports
detached from the release they came from, and a bare `linux-x64.tar.gz` is unidentifiable
once that happens.

## Licensing

Hermes is MIT licensed. These builds statically link `llvh`, a fork of LLVM vendored in the
Hermes tree, covered by Apache-2.0 WITH LLVM-exception. Argus itself is MIT.

:::caution[Not published yet]
The build-and-publish pipeline exists and is wired end to end, but no `hermes-bin-v*`
release has been cut yet. Until the first one lands, the prebuilt step reports a 404 and
the chain falls through to the bundled VM or `--provision`. Tracked on the
[roadmap](/reference/roadmap/).
:::

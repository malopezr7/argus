/**
 * Identity of the published Hermes binary assets — PURE. No filesystem, no
 * process. Producing the assets is the packaging script's job; knowing what
 * they are called and where they live is domain knowledge.
 *
 * This lives in core for the same reason `hermes-locations.ts` does: two sides
 * need the identical answer. CI PUBLISHES these assets and the provisioning
 * chain DOWNLOADS them, and a name derived independently in two places is a
 * name that eventually drifts.
 *
 * The binaries ship as GitHub Release assets rather than npm packages. npm
 * versions a package once at publish time, and these are versioned by the
 * HERMES version rather than the Argus version, because which binary a user
 * needs depends on their project: React Native 0.83 pins Hermes 250829098.0.4
 * and 0.86 pins 250829098.0.16, with the same Argus installed for both. They
 * are therefore never dependencies of any Argus package — they are resolved at
 * run time against the project's own pin, and a release on a public repository
 * serves that with no authentication, no size ceiling, and a CDN in front.
 */

import type { HermesEngine } from './hermes-version.js';
import { parseHermesTag } from './hermes-version.js';

/** Operating systems Argus publishes a prebuilt for, in `process.platform` terms. */
export type HermesBinOs = 'darwin' | 'linux';

/** Architectures Argus publishes a prebuilt for, in `process.arch` terms. */
export type HermesBinCpu = 'arm64' | 'x64';

/** One published target. The pair is what the asset name is built from. */
export interface HermesBinPlatform {
  os: HermesBinOs;
  cpu: HermesBinCpu;
}

/**
 * The published matrix.
 *
 * Windows is absent deliberately: it needs a different toolchain and a
 * different binary layout (`.exe`, bundled ICU DLLs), and no part of Argus is
 * verified on it yet. Adding a row here is the whole change when that lands.
 */
export const HERMES_BIN_PLATFORMS: readonly HermesBinPlatform[] = [
  { os: 'darwin', cpu: 'arm64' },
  { os: 'darwin', cpu: 'x64' },
  { os: 'linux', cpu: 'x64' },
  { os: 'linux', cpu: 'arm64' },
];

/** `owner/repo` the releases are published on. */
export const ARGUS_REPOSITORY = 'malopezr7/argus';

/**
 * Prefix marking a release as carrying Hermes binaries.
 *
 * Argus tags its own releases `v0.1.0`, and both live on the same repository,
 * so the two namespaces have to be separable at a glance and by prefix match. A
 * hyphen rather than a slash keeps the tag usable verbatim in a release asset
 * URL path, where a `/` would be ambiguous.
 */
export const HERMES_RELEASE_TAG_PREFIX = 'hermes-bin-v';

/**
 * A release tag needs a strict `major.minor.patch`, and not every Hermes ref is
 * one. Legacy pins are date-based (`2025-09-01-RNv0.82.0`) and RN 0.82 pins its
 * V1 engine as a bare commit SHA — neither can name a version.
 */
const RELEASE_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/**
 * The release version for a Hermes ref: the bare version with no `hermes-`/`v`
 * prefix, e.g. `hermes-v250829098.0.16` -> `250829098.0.16`.
 *
 * Returns undefined when the ref cannot name a version at all, so a caller
 * fails loudly at the point of publishing — or falls through at the point of
 * downloading — rather than inventing one.
 *
 * Doubles as the version of the official `hermes-compiler` npm package to check
 * bytecode parity against, which is published under exactly this number.
 */
export function hermesReleaseVersion(ref: string): string | undefined {
  const parsed = parseHermesTag(ref);
  if (parsed === undefined) return undefined;
  return RELEASE_VERSION_RE.test(parsed.version) ? parsed.version : undefined;
}

/**
 * Git tag of the release carrying `ref`'s binaries, e.g.
 * `hermes-bin-v250829098.0.16`.
 *
 * Undefined for a ref that cannot name a version — see `hermesReleaseVersion`.
 */
export function hermesReleaseTag(ref: string): string | undefined {
  const version = hermesReleaseVersion(ref);
  return version === undefined ? undefined : HERMES_RELEASE_TAG_PREFIX + version;
}

/**
 * Name of the archive holding `platform`'s build of `version`.
 *
 * Carries the version as well as the platform even though the release tag
 * already pins the version: assets get downloaded, renamed by browsers, and
 * dropped into issue reports detached from the release they came from, and a
 * bare `darwin-arm64.tar.gz` is unidentifiable once that happens.
 */
export function hermesAssetName(platform: HermesBinPlatform, version: string): string {
  return `hermes-${version}-${platform.os}-${platform.cpu}.tar.gz`;
}

/** Name of the per-asset checksum file, in `shasum -c` format. */
export function hermesChecksumAssetName(assetName: string): string {
  return `${assetName}.sha256`;
}

/**
 * Aggregate checksum file listing every asset in the release.
 *
 * Redundant with the per-asset files by design: the aggregate is what a human
 * verifies the whole release with in one command, and the per-asset file is
 * what the provisioning chain fetches when it wants exactly one archive and
 * should not pay for the others.
 */
export const HERMES_CHECKSUMS_ASSET = 'checksums.txt';

/** Public download URL of `assetName` in the release tagged `tag`. */
export function hermesAssetUrl(tag: string, assetName: string): string {
  return `https://github.com/${ARGUS_REPOSITORY}/releases/download/${tag}/${assetName}`;
}

/**
 * The published platform matching a host, or undefined when none is.
 *
 * Takes the loose `process.platform`/`process.arch` strings rather than the
 * narrowed types so a caller can hand over what the host actually reports —
 * `win32`, `freebsd`, `ppc64` — and get an honest "not published" instead of
 * having to narrow first and lose the answer.
 */
export function hermesReleasePlatform(os: string, cpu: string): HermesBinPlatform | undefined {
  return HERMES_BIN_PLATFORMS.find((platform) => platform.os === os && platform.cpu === cpu);
}

/** Human label for an engine, for use in prose. */
const ENGINE_LABEL: Readonly<Record<HermesEngine, string>> = {
  legacy: 'legacy',
  v1: 'V1',
};

/** Inputs for the release body. */
export interface HermesReleaseNotesOptions {
  /** Git tag the binaries were built from, e.g. `hermes-v250829098.0.16`. */
  tag: string;
  /** Engine that tag denotes. */
  engine: HermesEngine;
  /** Release version baked into the binaries, e.g. `250829098.0.16`. */
  version: string;
}

/**
 * Body of the GitHub Release.
 *
 * Built here rather than inlined in the workflow so its wording is asserted by
 * a test, and so the one place that knows what an asset is called is the one
 * place that describes it.
 */
export function hermesReleaseNotes(options: HermesReleaseNotesOptions): string {
  const { tag, engine, version } = options;
  const rows = HERMES_BIN_PLATFORMS.map(
    (platform) =>
      `| \`${platform.os}-${platform.cpu}\` | \`${hermesAssetName(platform, version)}\` |`,
  );

  return `Prebuilt Hermes ${ENGINE_LABEL[engine]} binaries, built from
[facebook/hermes](https://github.com/facebook/hermes) at tag \`${tag}\`.

Each archive is a gzipped tar holding three executables:

| File | What it is |
| --- | --- |
| \`hermes\` | The VM. Runs JavaScript or compiled bytecode. |
| \`hermesc\` | The compiler. Emits HBC bytecode. |
| \`hvm\` | The bytecode-only VM. |

| Platform | Asset |
| --- | --- |
${rows.join('\n')}

## You do not need to download these by hand

[Argus](https://github.com/${ARGUS_REPOSITORY}) fetches the right one at run
time, picking the Hermes version your project actually pins — React Native 0.83
and 0.86 want different ones with the same Argus installed. That is why this
release is versioned by the **Hermes** version (\`${version}\`) and not by the
Argus version, and why no Argus package depends on it.

## Verifying

Every asset ships a \`.sha256\` next to it, and \`${HERMES_CHECKSUMS_ASSET}\`
covers the whole release:

\`\`\`
shasum -a 256 -c ${HERMES_CHECKSUMS_ASSET}
\`\`\`

Argus verifies the checksum on download before it trusts an archive.

## Provenance

Built in CI with the configuration React Native uses for its own Hermes builds:
\`HERMES_ENABLE_INTL=ON\`, \`HERMES_ENABLE_DEBUGGER=ON\`,
\`HERMES_ENABLE_TEST_SUITE=OFF\`, \`CMAKE_BUILD_TYPE=Release\`.

Every build is gated on bytecode parity: the same source compiled by this
\`hermesc\` and by the official \`hermes-compiler@${version}\` package React
Native ships must produce a byte-identical \`.hbc\`.

Hermes is MIT licensed. The build statically links the vendored \`llvh\`, which
is Apache-2.0 WITH LLVM-exception.
`;
}

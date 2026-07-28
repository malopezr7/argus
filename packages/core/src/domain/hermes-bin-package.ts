/**
 * Identity of the prebuilt Hermes binary packages — PURE. No filesystem, no
 * process. Producing the package is the packaging script's job; knowing what it
 * is called and what its manifest must say is domain knowledge.
 *
 * This lives in core for the same reason `hermes-locations.ts` does: two sides
 * need the identical answer. The packaging pipeline WRITES these packages and
 * the provisioning chain will RESOLVE them, and a name derived independently in
 * two places is a name that eventually drifts.
 *
 * The versioning scheme is the load-bearing decision here. These packages are
 * versioned by the HERMES version, never by the Argus version, because which
 * binary a user needs depends on their project rather than on Argus: React
 * Native 0.83 pins Hermes 250829098.0.4 and 0.86 pins 250829098.0.16, with the
 * same Argus installed for both. A dependency pinned at publish time cannot
 * express that, so these are never declared as dependencies of any Argus
 * package — they are resolved at run time against the project's own pin.
 */

import type { HermesEngine } from './hermes-version.js';
import { parseHermesTag } from './hermes-version.js';

/** Operating systems Argus publishes a prebuilt for, in `process.platform` terms. */
export type HermesBinOs = 'darwin' | 'linux';

/** Architectures Argus publishes a prebuilt for, in `process.arch` terms. */
export type HermesBinCpu = 'arm64' | 'x64';

/** One published target. The pair is what the package name is built from. */
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

/** npm scope the binary packages publish under. */
export const HERMES_BIN_SCOPE = '@argus';

/** Directory inside the package holding the executables. */
export const HERMES_BIN_DIR = 'bin';

/** Name of the package carrying `platform`'s build. */
export function hermesBinPackageName(platform: HermesBinPlatform): string {
  return `${HERMES_BIN_SCOPE}/hermes-bin-${platform.os}-${platform.cpu}`;
}

/**
 * npm requires a strict `major.minor.patch`, and not every Hermes ref is one.
 * Legacy pins are date-based (`2025-09-01-RNv0.82.0`) and RN 0.82 pins its V1
 * engine as a bare commit SHA — neither can name an npm version.
 */
const PUBLISHABLE_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/**
 * The npm version for a Hermes ref: the bare version with no `hermes-`/`v`
 * prefix, e.g. `hermes-v250829098.0.16` -> `250829098.0.16`.
 *
 * Returns undefined when the ref cannot name an npm version at all, so a caller
 * fails loudly at the point of publishing rather than inventing a version.
 */
export function hermesBinPackageVersion(ref: string): string | undefined {
  const parsed = parseHermesTag(ref);
  if (parsed === undefined) return undefined;
  return PUBLISHABLE_VERSION_RE.test(parsed.version) ? parsed.version : undefined;
}

/** Inputs for the manifest of one binary package. */
export interface HermesBinManifestOptions {
  platform: HermesBinPlatform;
  /** npm version, from `hermesBinPackageVersion`. */
  version: string;
  /** Git tag the binaries were built from, e.g. `hermes-v250829098.0.16`. */
  tag: string;
  /** Engine the tag denotes. Reported in the description so the payload is legible. */
  engine: HermesEngine;
}

/**
 * A binary package's `package.json`.
 *
 * Deliberately has no `main` and no `types`: these ship executables, not
 * modules, and declaring an entry point would invite `import`ing them.
 */
export interface HermesBinManifest {
  name: string;
  version: string;
  description: string;
  /**
   * Matches what Meta declares for `hermes-compiler`, the npm package shipping
   * these same compiled binaries. The build statically links the vendored
   * `llvh` (Apache-2.0 WITH LLVM-exception); the package README records that.
   */
  license: 'MIT';
  repository: { type: 'git'; url: string };
  /** npm's platform gate — `process.platform` values. */
  os: readonly HermesBinOs[];
  /** npm's architecture gate — `process.arch` values. */
  cpu: readonly HermesBinCpu[];
  files: readonly string[];
}

const REPOSITORY_URL = 'git+https://github.com/malopezr7/argus.git';

/** Human label for an engine, for use in prose. */
const ENGINE_LABEL: Readonly<Record<HermesEngine, string>> = {
  legacy: 'legacy',
  v1: 'V1',
};

/** Build the `package.json` for one binary package. */
export function hermesBinPackageManifest(options: HermesBinManifestOptions): HermesBinManifest {
  const { platform, version, tag, engine } = options;

  return {
    name: hermesBinPackageName(platform),
    version,
    description:
      `Prebuilt Hermes ${ENGINE_LABEL[engine]} VM and compiler for ` +
      `${platform.os}-${platform.cpu}, built from facebook/hermes at ${tag}. ` +
      'Resolved at run time by Argus; not intended to be depended on directly.',
    license: 'MIT',
    repository: { type: 'git', url: REPOSITORY_URL },
    os: [platform.os],
    cpu: [platform.cpu],
    files: [HERMES_BIN_DIR],
  };
}

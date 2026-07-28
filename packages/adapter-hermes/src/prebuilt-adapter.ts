import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ARGUS_CACHE_SEGMENTS,
  type EngineTarget,
  HERMES_BUILD_TARGETS,
  type HermesBinary,
  type HermesProvisioner,
  type HermesRef,
  hermesAssetName,
  hermesAssetUrl,
  hermesCacheBinarySegments,
  hermesChecksumAssetName,
  hermesReleasePlatform,
  hermesReleaseTag,
  hermesReleaseVersion,
} from '@arguslab/core';
import {
  type AssetFetcher,
  fetchAssetOverHttps,
  findChecksum,
  verifyChecksum,
} from './prebuilt-assets.js';
import { readTarGz, TarError } from './tar.js';
import { detectArch, readHermesVersionInfo } from './utils.js';

/**
 * PrebuiltAdapter — resolves a `HermesRef` to a local binary by downloading the
 * matching GitHub Release asset.
 *
 * The binaries live on releases of the Argus repository rather than on npm.
 * Which Hermes a user needs follows from their React Native version, not from
 * which Argus they installed, so the binary cannot be a dependency pinned at
 * publish time — it has to be resolved at run time. A release on a public
 * repository serves that with no authentication, no practical size limit, and a
 * CDN in front.
 *
 * Two outcomes are NOT failures and are signalled with `PrebuiltUnavailableError`
 * so the provisioning chain can move past them: nothing is published for this
 * ref or this platform, and the network could not be reached. A download that
 * arrives but does not verify is the opposite — a checksum mismatch or a
 * malformed archive is reported loudly and stops provisioning, because falling
 * through would turn a tampered release into a silent source build.
 */

/** Mode the extracted executables must carry. */
const EXECUTABLE_MODE = 0o755;

/** A prebuilt cannot supply this ref. Ordinary; the chain continues past it. */
export class PrebuiltUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PrebuiltUnavailableError';
  }
}

export interface PrebuiltAdapterOptions {
  /** The engine ref to download. */
  ref: HermesRef;
  /** The HTTP boundary. Defaults to real `fetch`; tests inject a stub. */
  fetchAsset?: AssetFetcher;
  /** Home directory the cache is rooted at. Defaults to the real one. */
  homeDir?: string;
}

export class PrebuiltAdapter implements HermesProvisioner {
  private readonly ref: HermesRef;
  private readonly fetchAsset: AssetFetcher;
  private readonly homeDir: string;

  constructor(options: PrebuiltAdapterOptions) {
    this.ref = options.ref;
    this.fetchAsset = options.fetchAsset ?? fetchAssetOverHttps;
    this.homeDir = options.homeDir ?? homedir();
  }

  async resolve(target: EngineTarget): Promise<HermesBinary> {
    const { tag } = this.ref;
    const segments = hermesCacheBinarySegments(tag);
    const binary = join(this.homeDir, ...segments);

    // A cache hit means no network at all — the common case once a project has
    // run once, and the reason this is checked before anything is derived.
    if (isExecutable(binary)) return this.describe(binary);

    const version = hermesReleaseVersion(tag);
    const releaseTag = hermesReleaseTag(tag);
    if (version === undefined || releaseTag === undefined) {
      throw new PrebuiltUnavailableError(
        `${tag} cannot name a release version — date-based refs and bare commit ` +
          'SHAs are not published as prebuilts',
      );
    }

    const platform = hermesReleasePlatform(target.os, target.arch);
    if (platform === undefined) {
      throw new PrebuiltUnavailableError(
        `no prebuilt is published for ${target.os}-${target.arch}`,
      );
    }

    const assetName = hermesAssetName(platform, version);
    const archive = await this.download(releaseTag, assetName, version);

    extractInto(archive, this.homeDir, segments);
    return this.describe(binary);
  }

  /** Fetch the asset and its checksum, and refuse to return unverified bytes. */
  private async download(releaseTag: string, assetName: string, version: string): Promise<Buffer> {
    const checksumName = hermesChecksumAssetName(assetName);
    const checksumUrl = hermesAssetUrl(releaseTag, checksumName);

    // The checksum comes first, and is small: when a version was never
    // published, this is a cheap 404 rather than a wasted multi-megabyte body.
    const checksumResponse = await this.fetchAsset(checksumUrl);
    if (checksumResponse.kind === 'not-found') {
      throw new PrebuiltUnavailableError(
        `no published prebuilt for Hermes ${version} on this platform (${checksumUrl} is 404)`,
      );
    }
    if (checksumResponse.kind === 'error') {
      throw new PrebuiltUnavailableError(
        `could not reach the prebuilt release: ${checksumResponse.reason}`,
      );
    }

    const expected = findChecksum(checksumResponse.bytes.toString('utf8'), assetName);
    if (expected === undefined) {
      throw new Error(
        `${checksumName} does not list a sha256 for ${assetName}. The published ` +
          'release is malformed; Argus will not run an unverifiable binary.',
      );
    }

    const assetUrl = hermesAssetUrl(releaseTag, assetName);
    const assetResponse = await this.fetchAsset(assetUrl);
    if (assetResponse.kind === 'not-found') {
      throw new PrebuiltUnavailableError(`no published prebuilt at ${assetUrl}`);
    }
    if (assetResponse.kind === 'error') {
      throw new PrebuiltUnavailableError(
        `could not download the prebuilt: ${assetResponse.reason}`,
      );
    }

    verifyChecksum(assetName, assetResponse.bytes, expected);
    return assetResponse.bytes;
  }

  /** Read back what was just placed on disk, exactly as the other adapters do. */
  private describe(binary: string): HermesBinary {
    return {
      path: binary,
      version: this.ref.tag,
      arch: detectArch(binary),
      ...readHermesVersionInfo(binary),
    };
  }
}

/** True when `path` is a file the current user may execute. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unpack `archive` into the cache at the canonical location.
 *
 * Extraction happens in a sibling temp directory and is moved into place with a
 * single rename, so a run that dies part-way leaves nothing behind. The
 * alternative — writing straight into the cache — produces a directory that a
 * later run would find, treat as a hit, and try to execute.
 *
 * The temp directory is inside the cache root rather than in the system temp
 * dir on purpose: `rename` is only atomic within a filesystem, and `~` and
 * `/tmp` are routinely different ones.
 */
function extractInto(archive: Buffer, homeDir: string, binarySegments: readonly string[]): void {
  let entries: ReturnType<typeof readTarGz>;
  try {
    entries = readTarGz(archive);
  } catch (error) {
    if (error instanceof TarError) {
      throw new Error(`the downloaded prebuilt is not a usable archive: ${error.message}`);
    }
    throw error;
  }

  const found = entries.map((entry) => entry.path).sort();
  const expected = [...HERMES_BUILD_TARGETS].sort();
  if (found.join(',') !== expected.join(',')) {
    throw new Error(
      `the downloaded prebuilt holds ${found.length === 0 ? 'nothing' : found.join(', ')}, ` +
        `but ${expected.join(', ')} were expected`,
    );
  }

  // `hermesCacheBinarySegments` ends in the executable's own name; everything
  // before it is the directory the archive unpacks into.
  const binDirSegments = binarySegments.slice(0, -1);
  const cacheRoot = join(homeDir, ...ARGUS_CACHE_SEGMENTS);
  const destination = join(homeDir, ...binDirSegments);

  mkdirSync(cacheRoot, { recursive: true });
  const staging = mkdtempSync(join(cacheRoot, '.staging-'));

  try {
    for (const entry of entries) {
      const path = join(staging, entry.path);
      writeFileSync(path, entry.data);
      // The archive records the mode, but `writeFileSync`'s own `mode` option
      // only applies when it creates the file, and a binary that arrives
      // non-executable fails silently much later. Set it explicitly.
      chmodSync(path, EXECUTABLE_MODE);
    }

    mkdirSync(join(homeDir, ...binDirSegments.slice(0, -1)), { recursive: true });
    renameSync(staging, destination);
  } catch (error) {
    // Another process may have won the race and populated the cache while this
    // one was downloading. That is a success, not a collision.
    if (existsSync(join(homeDir, ...binarySegments))) return;
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

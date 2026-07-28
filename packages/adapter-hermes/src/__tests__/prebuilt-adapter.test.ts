import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineTarget, HermesRef } from '@arguslab/core';
import { afterAll, describe, expect, it } from 'vitest';
import { PrebuiltAdapter, PrebuiltUnavailableError } from '../prebuilt-adapter.js';
import {
  type AssetResponse,
  ChecksumMismatchError,
  findChecksum,
  sha256,
} from '../prebuilt-assets.js';
import { writeTarGz } from '../tar.js';

/**
 * Every test drives an injected fetcher, so none of them touches the network —
 * which is the point: the interesting behaviour is what happens when a download
 * is missing, corrupt, or interrupted, and none of that is observable against a
 * real release.
 */

const V1: HermesRef = { engine: 'v1', tag: 'hermes-v250829098.0.16', version: '250829098.0.16' };
const DATE_REF: HermesRef = {
  engine: 'legacy',
  tag: 'hermes-2025-09-01-RNv0.82.0',
  version: '2025-09-01-RNv0.82.0',
};

const TARGET: EngineTarget = { rnVersion: '0.86.2', os: 'darwin', arch: 'arm64' };

const ASSET = 'hermes-250829098.0.16-darwin-arm64.tar.gz';
const CHECKSUM_ASSET = `${ASSET}.sha256`;

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-prebuilt-'));
  tempRoots.push(dir);
  return dir;
}

/** A stand-in for the three executables, answering `--version` like Hermes. */
function fakeBinaries(bytecodeVersion = 98): Buffer {
  const script = `#!/bin/sh\necho "Hermes JavaScript compiler."\necho "  Hermes release version: 250829098.0.16"\necho "  HBC bytecode version: ${bytecodeVersion}"\n`;
  return writeTarGz([
    { path: 'hermes', mode: 0o755, data: Buffer.from(script) },
    { path: 'hermesc', mode: 0o755, data: Buffer.from(script) },
    { path: 'hvm', mode: 0o755, data: Buffer.from(script) },
  ]);
}

/** Records every URL asked for, and answers from a fixed table. */
function fetcher(table: Record<string, AssetResponse>) {
  const requested: string[] = [];
  const fetchAsset = async (url: string): Promise<AssetResponse> => {
    requested.push(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    return table[name] ?? { kind: 'not-found' };
  };
  return { fetchAsset, requested };
}

/** A table serving `archive` with a matching, correct checksum. */
function publishedRelease(archive: Buffer): Record<string, AssetResponse> {
  return {
    [ASSET]: { kind: 'ok', bytes: archive },
    [CHECKSUM_ASSET]: { kind: 'ok', bytes: Buffer.from(`${sha256(archive)}  ${ASSET}\n`) },
  };
}

const cacheBinary = (homeDir: string): string =>
  join(homeDir, '.argus', 'cache', `hermes-${V1.tag}`, 'build', 'bin', 'hermes');

describe('PrebuiltAdapter — cache', () => {
  it('returns a cached binary without touching the network', async () => {
    const homeDir = tempDir();
    const binary = cacheBinary(homeDir);
    mkdirSync(join(binary, '..'), { recursive: true });
    writeFileSync(binary, '#!/bin/sh\necho "  HBC bytecode version: 98"\n');
    chmodSync(binary, 0o755);

    const net = fetcher({});
    const result = await new PrebuiltAdapter({
      ref: V1,
      homeDir,
      fetchAsset: net.fetchAsset,
    }).resolve(TARGET);

    expect(net.requested).toEqual([]);
    expect(result.path).toBe(binary);
    expect(result.bytecodeVersion).toBe(98);
  });

  it('ignores a cache entry that is present but not executable', async () => {
    const homeDir = tempDir();
    const binary = cacheBinary(homeDir);
    mkdirSync(join(binary, '..'), { recursive: true });
    writeFileSync(binary, 'not executable');
    chmodSync(binary, 0o644);

    const net = fetcher({});
    await expect(
      new PrebuiltAdapter({ ref: V1, homeDir, fetchAsset: net.fetchAsset }).resolve(TARGET),
    ).rejects.toThrow(PrebuiltUnavailableError);
    expect(net.requested.length).toBeGreaterThan(0);
  });
});

describe('PrebuiltAdapter — downloading', () => {
  it('downloads, verifies, extracts and reports the binary', async () => {
    const homeDir = tempDir();
    const archive = fakeBinaries();
    const net = fetcher(publishedRelease(archive));

    const result = await new PrebuiltAdapter({
      ref: V1,
      homeDir,
      fetchAsset: net.fetchAsset,
    }).resolve(TARGET);

    expect(result.path).toBe(cacheBinary(homeDir));
    expect(result.version).toBe(V1.tag);
    expect(result.releaseVersion).toBe('250829098.0.16');
    expect(result.bytecodeVersion).toBe(98);
  });

  it('fetches the small checksum before the multi-megabyte archive', async () => {
    const net = fetcher(publishedRelease(fakeBinaries()));
    await new PrebuiltAdapter({
      ref: V1,
      homeDir: tempDir(),
      fetchAsset: net.fetchAsset,
    }).resolve(TARGET);

    expect(net.requested.map((url) => url.slice(url.lastIndexOf('/') + 1))).toEqual([
      CHECKSUM_ASSET,
      ASSET,
    ]);
  });

  it('asks for the asset under the hermes-bin release tag', async () => {
    const net = fetcher(publishedRelease(fakeBinaries()));
    await new PrebuiltAdapter({
      ref: V1,
      homeDir: tempDir(),
      fetchAsset: net.fetchAsset,
    }).resolve(TARGET);

    expect(net.requested[0]).toBe(
      'https://github.com/malopezr7/argus/releases/download/' +
        `hermes-bin-v250829098.0.16/${CHECKSUM_ASSET}`,
    );
  });

  it('leaves all three executables in the cache, executable', async () => {
    const homeDir = tempDir();
    await new PrebuiltAdapter({
      ref: V1,
      homeDir,
      fetchAsset: fetcher(publishedRelease(fakeBinaries())).fetchAsset,
    }).resolve(TARGET);

    const binDir = join(homeDir, '.argus', 'cache', `hermes-${V1.tag}`, 'build', 'bin');
    expect(readdirSync(binDir).sort()).toEqual(['hermes', 'hermesc', 'hvm']);
  });

  it('is a cache hit on the second call, with no further requests', async () => {
    const homeDir = tempDir();
    const net = fetcher(publishedRelease(fakeBinaries()));
    const adapter = new PrebuiltAdapter({ ref: V1, homeDir, fetchAsset: net.fetchAsset });

    await adapter.resolve(TARGET);
    const requestsAfterFirst = net.requested.length;
    await adapter.resolve(TARGET);

    expect(net.requested).toHaveLength(requestsAfterFirst);
  });
});

describe('PrebuiltAdapter — a missing asset is not a crash', () => {
  it('reports unavailable when nothing is published for the version', async () => {
    const attempt = new PrebuiltAdapter({
      ref: V1,
      homeDir: tempDir(),
      fetchAsset: fetcher({}).fetchAsset,
    }).resolve(TARGET);

    await expect(attempt).rejects.toBeInstanceOf(PrebuiltUnavailableError);
    await expect(attempt).rejects.toThrow(/no published prebuilt/);
  });

  it('reports unavailable for a platform nothing is built for', async () => {
    const net = fetcher(publishedRelease(fakeBinaries()));
    const attempt = new PrebuiltAdapter({
      ref: V1,
      homeDir: tempDir(),
      fetchAsset: net.fetchAsset,
    }).resolve({ ...TARGET, os: 'win32' });

    await expect(attempt).rejects.toThrow(/no prebuilt is published for win32-arm64/);
    // The platform is unpublishable on its face, so nothing is requested.
    expect(net.requested).toEqual([]);
  });

  it('reports unavailable for a ref that cannot name a version', async () => {
    const net = fetcher({});
    const attempt = new PrebuiltAdapter({
      ref: DATE_REF,
      homeDir: tempDir(),
      fetchAsset: net.fetchAsset,
    }).resolve(TARGET);

    await expect(attempt).rejects.toThrow(/cannot name a release version/);
    expect(net.requested).toEqual([]);
  });

  it('reports unavailable rather than exploding when the network is unreachable', async () => {
    const attempt = new PrebuiltAdapter({
      ref: V1,
      homeDir: tempDir(),
      fetchAsset: fetcher({
        [CHECKSUM_ASSET]: { kind: 'error', reason: 'getaddrinfo ENOTFOUND github.com' },
      }).fetchAsset,
    }).resolve(TARGET);

    await expect(attempt).rejects.toBeInstanceOf(PrebuiltUnavailableError);
    await expect(attempt).rejects.toThrow(/ENOTFOUND/);
  });
});

describe('PrebuiltAdapter — an unverifiable download is a hard error', () => {
  it('refuses an archive whose checksum does not match', async () => {
    const homeDir = tempDir();
    const attempt = new PrebuiltAdapter({
      ref: V1,
      homeDir,
      fetchAsset: fetcher({
        [ASSET]: { kind: 'ok', bytes: fakeBinaries() },
        [CHECKSUM_ASSET]: { kind: 'ok', bytes: Buffer.from(`${'0'.repeat(64)}  ${ASSET}\n`) },
      }).fetchAsset,
    }).resolve(TARGET);

    await expect(attempt).rejects.toBeInstanceOf(ChecksumMismatchError);
    await expect(attempt).rejects.not.toBeInstanceOf(PrebuiltUnavailableError);
    expect(existsSync(cacheBinary(homeDir))).toBe(false);
  });

  it('refuses a checksum file that does not cover the asset', async () => {
    const attempt = new PrebuiltAdapter({
      ref: V1,
      homeDir: tempDir(),
      fetchAsset: fetcher({
        [ASSET]: { kind: 'ok', bytes: fakeBinaries() },
        [CHECKSUM_ASSET]: { kind: 'ok', bytes: Buffer.from(`${'0'.repeat(64)}  something-else\n`) },
      }).fetchAsset,
    }).resolve(TARGET);

    await expect(attempt).rejects.toThrow(/does not list a sha256/);
  });

  it('refuses a truncated archive that still hashes to its published digest', async () => {
    // Truncation upstream of the publisher: the checksum matches the bytes that
    // were served, and only the tar layer can tell that they are incomplete.
    const truncated = fakeBinaries().subarray(0, 200);
    const homeDir = tempDir();
    const attempt = new PrebuiltAdapter({
      ref: V1,
      homeDir,
      fetchAsset: fetcher(publishedRelease(truncated)).fetchAsset,
    }).resolve(TARGET);

    await expect(attempt).rejects.toThrow(/not a usable archive/);
    expect(existsSync(cacheBinary(homeDir))).toBe(false);
  });

  it('refuses an archive missing one of the three executables', async () => {
    const partial = writeTarGz([{ path: 'hermes', mode: 0o755, data: Buffer.from('#!/bin/sh\n') }]);
    const homeDir = tempDir();

    await expect(
      new PrebuiltAdapter({
        ref: V1,
        homeDir,
        fetchAsset: fetcher(publishedRelease(partial)).fetchAsset,
      }).resolve(TARGET),
    ).rejects.toThrow(/but hermes, hermesc, hvm were expected/);
    expect(existsSync(cacheBinary(homeDir))).toBe(false);
  });
});

describe('PrebuiltAdapter — a failed extraction leaves no cache entry', () => {
  it('does not publish a half-extracted cache directory', async () => {
    const homeDir = tempDir();
    // Occupy the destination with a non-empty directory so the final rename
    // fails, which is exactly the moment the atomic move has to protect.
    const binDir = join(homeDir, '.argus', 'cache', `hermes-${V1.tag}`, 'build', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'occupied'), 'x');

    await expect(
      new PrebuiltAdapter({
        ref: V1,
        homeDir,
        fetchAsset: fetcher(publishedRelease(fakeBinaries())).fetchAsset,
      }).resolve(TARGET),
    ).rejects.toThrow();

    // Nothing a later run could mistake for a usable cache entry.
    expect(existsSync(join(binDir, 'hermes'))).toBe(false);
    expect(readdirSync(binDir)).toEqual(['occupied']);
  });

  it('cleans up its staging directory rather than littering the cache', async () => {
    const homeDir = tempDir();
    const binDir = join(homeDir, '.argus', 'cache', `hermes-${V1.tag}`, 'build', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'occupied'), 'x');

    await expect(
      new PrebuiltAdapter({
        ref: V1,
        homeDir,
        fetchAsset: fetcher(publishedRelease(fakeBinaries())).fetchAsset,
      }).resolve(TARGET),
    ).rejects.toThrow();

    const cacheRoot = join(homeDir, '.argus', 'cache');
    expect(readdirSync(cacheRoot).filter((name) => name.startsWith('.staging-'))).toEqual([]);
  });
});

describe('findChecksum', () => {
  it('reads the digest for a named asset out of an aggregate file', () => {
    const contents = `${'a'.repeat(64)}  other.tar.gz\n${'b'.repeat(64)}  ${ASSET}\n`;

    expect(findChecksum(contents, ASSET)).toBe('b'.repeat(64));
  });

  it("accepts shasum's binary marker", () => {
    expect(findChecksum(`${'c'.repeat(64)} *${ASSET}\n`, ASSET)).toBe('c'.repeat(64));
  });

  it('returns nothing when the asset is not listed', () => {
    expect(findChecksum(`${'a'.repeat(64)}  other.tar.gz\n`, ASSET)).toBeUndefined();
    expect(findChecksum('', ASSET)).toBeUndefined();
    expect(findChecksum('garbage', ASSET)).toBeUndefined();
  });
});

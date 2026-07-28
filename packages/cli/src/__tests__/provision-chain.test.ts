import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HermesRef } from '@arguslab/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bundledLegacyVmPath,
  type ChainInput,
  cacheBinaryPath,
  type ExecutableProbe,
  projectVendoredPath,
  selectProvisionSource,
} from '../provision/chain.js';
import { isExecutableFile } from '../provision/provision.js';

/**
 * Precedence is tested with an injected probe so the ORDER is asserted without
 * touching disk. The filesystem-shaped rules — "exists", "is executable" — get
 * real temp fixtures, since a stubbed probe cannot prove those.
 */

const V1: HermesRef = { engine: 'v1', tag: 'hermes-v250829098.0.16', version: '250829098.0.16' };
const LEGACY: HermesRef = { engine: 'legacy', tag: 'hermes-v0.17.0', version: '0.17.0' };

const HOME = '/home/dev';
const PROJECT = '/proj';
const RN_DIR = '/proj/node_modules/react-native';

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-chain-'));
  tempRoots.push(dir);
  return dir;
}

/** A probe that reports exactly the listed paths as runnable binaries. */
function probeFor(...present: string[]): ExecutableProbe {
  return (path) => present.includes(path);
}

const NOTHING: ExecutableProbe = () => false;

function input(overrides: Partial<ChainInput> = {}): ChainInput {
  return {
    projectDir: PROJECT,
    homeDir: HOME,
    platform: 'darwin',
    arch: 'arm64',
    allowSourceBuild: false,
    ...overrides,
  };
}

/**
 * The prebuilt step is reached by most of these fixtures, and it would win
 * before the source build could be reached. Marking it already-tried is how a
 * test looks at the steps BELOW it, and mirrors what `provision.ts` does after
 * a download reports that nothing is published.
 */
const PREBUILT_TRIED = 'nothing published for this ref';

describe('selectProvisionSource — precedence', () => {
  it('explicit beats a vendored binary and a usable cache entry', () => {
    const outcome = selectProvisionSource(
      input({ explicit: { path: '/tmp/mine', origin: 'flag' }, ref: V1 }),
      probeFor(projectVendoredPath(PROJECT), cacheBinaryPath(HOME, V1)),
    );

    expect(outcome).toEqual({
      kind: 'selected',
      source: { kind: 'explicit', origin: 'flag', path: '/tmp/mine' },
      attempted: [],
    });
  });

  it('honours an explicit path without probing it, so a typo is not swallowed', () => {
    const outcome = selectProvisionSource(
      input({ explicit: { path: '/tmp/typo', origin: 'env' }, ref: V1 }),
      NOTHING,
    );

    expect(outcome.kind).toBe('selected');
    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'explicit',
      origin: 'env',
      path: '/tmp/typo',
    });
  });

  it('a project-vendored binary beats the cache', () => {
    const vendored = projectVendoredPath(PROJECT);

    const outcome = selectProvisionSource(
      input({ ref: V1 }),
      probeFor(vendored, cacheBinaryPath(HOME, V1)),
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'project-vendored',
      path: vendored,
    });
  });

  it('uses a vendored binary even when no engine could be resolved', () => {
    const vendored = projectVendoredPath(PROJECT);

    const outcome = selectProvisionSource(input(), probeFor(vendored));

    expect(outcome.kind === 'selected' && outcome.source.kind).toBe('project-vendored');
  });

  it('falls through when the project vendors nothing', () => {
    const outcome = selectProvisionSource(input({ ref: V1 }), probeFor(cacheBinaryPath(HOME, V1)));

    expect(outcome.kind === 'selected' && outcome.source.kind).toBe('cache');
  });

  it('cache beats the bundled VM', () => {
    const cached = cacheBinaryPath(HOME, LEGACY);
    const bundled = bundledLegacyVmPath(RN_DIR);

    const outcome = selectProvisionSource(
      input({ ref: LEGACY, reactNativeDir: RN_DIR }),
      probeFor(cached, bundled),
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'cache',
      path: cached,
      ref: LEGACY,
    });
  });

  it('falls through to the bundled VM when the cache is empty', () => {
    const bundled = bundledLegacyVmPath(RN_DIR);

    const outcome = selectProvisionSource(
      input({ ref: LEGACY, reactNativeDir: RN_DIR }),
      probeFor(bundled),
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'bundled-legacy',
      path: bundled,
      ref: LEGACY,
    });
  });
});

describe('selectProvisionSource — bundled VM applicability', () => {
  it('is skipped when the project targets v1', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, reactNativeDir: RN_DIR, prebuiltUnavailable: PREBUILT_TRIED }),
      probeFor(bundledLegacyVmPath(RN_DIR)),
    );

    expect(outcome.kind).toBe('exhausted');
    const bundled = outcome.attempted.find((a) => a.kind === 'bundled-legacy');
    expect(bundled?.reason).toContain('legacy');
    expect(bundled?.reason).toContain('v1');
  });

  it('is skipped when the file is missing', () => {
    const outcome = selectProvisionSource(
      input({ ref: LEGACY, reactNativeDir: RN_DIR, prebuiltUnavailable: PREBUILT_TRIED }),
      NOTHING,
    );

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'bundled-legacy')?.path).toBe(
      bundledLegacyVmPath(RN_DIR),
    );
  });

  it('is skipped when no react-native install was found', () => {
    const outcome = selectProvisionSource(
      input({ ref: LEGACY, prebuiltUnavailable: PREBUILT_TRIED }),
      NOTHING,
    );

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'bundled-legacy')?.reason).toContain(
      'react-native',
    );
  });

  it('is skipped off macOS, where the Mach-O binary cannot run', () => {
    // The VM IS present; only the host platform disqualifies it.
    const outcome = selectProvisionSource(
      input({
        ref: LEGACY,
        reactNativeDir: RN_DIR,
        platform: 'linux',
        prebuiltUnavailable: PREBUILT_TRIED,
      }),
      probeFor(bundledLegacyVmPath(RN_DIR)),
    );

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'bundled-legacy')?.reason).toContain('linux');
  });

  it('is skipped when the file exists but is not executable', () => {
    const rnDir = join(tempDir(), 'node_modules', 'react-native');
    const vmPath = bundledLegacyVmPath(rnDir);
    mkdirSync(join(rnDir, 'sdks', 'hermesc', 'osx-bin'), { recursive: true });
    writeFileSync(vmPath, '#!/bin/sh\n');
    chmodSync(vmPath, 0o644);

    const outcome = selectProvisionSource(
      input({
        ref: LEGACY,
        reactNativeDir: rnDir,
        homeDir: tempDir(),
        projectDir: tempDir(),
        prebuiltUnavailable: PREBUILT_TRIED,
      }),
      isExecutableFile,
    );

    expect(outcome.kind).toBe('exhausted');
  });

  it('is selected when the file exists and is executable', () => {
    const rnDir = join(tempDir(), 'node_modules', 'react-native');
    const vmPath = bundledLegacyVmPath(rnDir);
    mkdirSync(join(rnDir, 'sdks', 'hermesc', 'osx-bin'), { recursive: true });
    writeFileSync(vmPath, '#!/bin/sh\n');
    chmodSync(vmPath, 0o755);

    const outcome = selectProvisionSource(
      // Empty home and project dirs, so neither earlier source can answer.
      input({
        ref: LEGACY,
        reactNativeDir: rnDir,
        homeDir: tempDir(),
        projectDir: tempDir(),
        platform: 'darwin',
      }),
      isExecutableFile,
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'bundled-legacy',
      path: vmPath,
      ref: LEGACY,
    });
  });
});

describe('selectProvisionSource — prebuilt download', () => {
  it('is selected after the cache and before a source build', () => {
    const outcome = selectProvisionSource(input({ ref: V1, allowSourceBuild: true }), NOTHING);

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'prebuilt',
      ref: V1,
      platform: { os: 'darwin', cpu: 'arm64' },
    });
    // Everything above it was tried first; the source build was never reached.
    expect(outcome.attempted.map((a) => a.kind)).toEqual([
      'project-vendored',
      'cache',
      'bundled-legacy',
    ]);
  });

  it('loses to a cache hit, so a downloaded binary is fetched once', () => {
    const cached = cacheBinaryPath(HOME, V1);

    const outcome = selectProvisionSource(input({ ref: V1 }), probeFor(cached));

    expect(outcome.kind === 'selected' && outcome.source.kind).toBe('cache');
  });

  it('carries the host platform it resolved to', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, platform: 'linux', arch: 'x64' }),
      NOTHING,
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'prebuilt',
      ref: V1,
      platform: { os: 'linux', cpu: 'x64' },
    });
  });

  it('is skipped on a platform nothing is published for', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, platform: 'win32', arch: 'x64' }),
      NOTHING,
    );

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'prebuilt')?.reason).toContain('win32-x64');
  });

  it('is skipped for a ref that cannot name a release version', () => {
    const dateRef: HermesRef = {
      engine: 'legacy',
      tag: 'hermes-2025-09-01-RNv0.82.0',
      version: '2025-09-01-RNv0.82.0',
    };

    const outcome = selectProvisionSource(input({ ref: dateRef }), NOTHING);

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'prebuilt')?.reason).toContain(
      'cannot name a release version',
    );
  });

  it('is skipped when no engine was resolved', () => {
    const outcome = selectProvisionSource(input(), NOTHING);

    expect(outcome.attempted.find((a) => a.kind === 'prebuilt')?.reason).toContain(
      'no engine resolved',
    );
  });

  it('falls through to the source build once a download reported nothing published', () => {
    // What `provision.ts` does after the adapter answers PrebuiltUnavailable:
    // walk again with the reason recorded. The step must then step aside
    // instead of aborting the whole chain.
    const outcome = selectProvisionSource(
      input({
        ref: V1,
        allowSourceBuild: true,
        prebuiltUnavailable: 'no published prebuilt for Hermes 250829098.0.16',
      }),
      NOTHING,
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'source-build',
      ref: V1,
    });
  });

  it('reports the download failure verbatim, so the message stays truthful', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, prebuiltUnavailable: 'could not reach the prebuilt release: ENOTFOUND' }),
      NOTHING,
    );

    expect(outcome.attempted.find((a) => a.kind === 'prebuilt')?.reason).toBe(
      'could not reach the prebuilt release: ENOTFOUND',
    );
  });
});

describe('selectProvisionSource — source build is opt-in', () => {
  it('is not attempted without --provision', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, prebuiltUnavailable: PREBUILT_TRIED }),
      NOTHING,
    );

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'source-build')?.reason).toContain(
      '--provision',
    );
  });

  it('is selected once --provision authorises it', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, allowSourceBuild: true, prebuiltUnavailable: PREBUILT_TRIED }),
      NOTHING,
    );

    expect(outcome.kind === 'selected' && outcome.source).toEqual({
      kind: 'source-build',
      ref: V1,
    });
  });

  it('is not attempted with --provision when no engine was resolved', () => {
    const outcome = selectProvisionSource(input({ allowSourceBuild: true }), NOTHING);

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'source-build')?.reason).toContain('ref');
  });
});

describe('selectProvisionSource — exhausted', () => {
  it('records every source it tried, in chain order', () => {
    const outcome = selectProvisionSource(
      input({ ref: V1, reactNativeDir: RN_DIR, prebuiltUnavailable: PREBUILT_TRIED }),
      NOTHING,
    );

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.map((a) => a.kind)).toEqual([
      'project-vendored',
      'cache',
      'bundled-legacy',
      'prebuilt',
      'source-build',
    ]);
  });

  it('explains that an unresolved engine leaves nothing to look up', () => {
    const outcome = selectProvisionSource(input(), NOTHING);

    expect(outcome.kind).toBe('exhausted');
    expect(outcome.attempted.find((a) => a.kind === 'cache')?.reason).toContain('no engine');
  });
});

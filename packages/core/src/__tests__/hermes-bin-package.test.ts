import { describe, expect, it } from 'vitest';
import {
  HERMES_BIN_PLATFORMS,
  hermesBinPackageManifest,
  hermesBinPackageName,
  hermesBinPackageVersion,
} from '../domain/hermes-bin-package.js';
import { HERMES_PINS_BY_RN_MINOR } from '../domain/hermes-pins.js';

describe('package names', () => {
  it('names a package after its os and cpu', () => {
    expect(hermesBinPackageName({ os: 'darwin', cpu: 'arm64' })).toBe(
      '@argus/hermes-bin-darwin-arm64',
    );
    expect(hermesBinPackageName({ os: 'linux', cpu: 'x64' })).toBe('@argus/hermes-bin-linux-x64');
  });

  it('gives every published platform a distinct name', () => {
    const names = HERMES_BIN_PLATFORMS.map(hermesBinPackageName);

    expect(new Set(names).size).toBe(HERMES_BIN_PLATFORMS.length);
  });

  it('publishes the four P0 targets and no others', () => {
    expect(HERMES_BIN_PLATFORMS.map(hermesBinPackageName)).toEqual([
      '@argus/hermes-bin-darwin-arm64',
      '@argus/hermes-bin-darwin-x64',
      '@argus/hermes-bin-linux-x64',
      '@argus/hermes-bin-linux-arm64',
    ]);
  });
});

describe('package versions', () => {
  it('strips the tag prefix down to the bare version', () => {
    expect(hermesBinPackageVersion('hermes-v250829098.0.16')).toBe('250829098.0.16');
    expect(hermesBinPackageVersion('hermes-v0.17.0')).toBe('0.17.0');
  });

  it('accepts a bare version as readily as a full tag', () => {
    expect(hermesBinPackageVersion('v250829098.0.16')).toBe('250829098.0.16');
    expect(hermesBinPackageVersion('250829098.0.16')).toBe('250829098.0.16');
  });

  it('refuses a date-based ref, which cannot name an npm version', () => {
    expect(hermesBinPackageVersion('hermes-2025-09-01-RNv0.82.0')).toBeUndefined();
  });

  it('refuses a bare commit SHA', () => {
    expect(hermesBinPackageVersion('76dc3793')).toBeUndefined();
  });

  it('refuses an unparsable ref', () => {
    expect(hermesBinPackageVersion('')).toBeUndefined();
    expect(hermesBinPackageVersion('not-a-ref')).toBeUndefined();
  });

  it('publishes every semver pin in the RN table', () => {
    // The pins that are not semver (date tags, the 0.82 V1 SHA) are exactly the
    // ones this scheme cannot publish, and the guard must agree with the table.
    const refs = Object.values(HERMES_PINS_BY_RN_MINOR).flatMap((pins) =>
      [pins.legacy, pins.v1].filter((ref) => ref !== undefined),
    );
    const publishable = refs.filter((ref) => hermesBinPackageVersion(ref) !== undefined);

    expect(publishable).toEqual([
      'v250829098.0.16',
      'v0.17.0',
      'v250829098.0.16',
      'v0.16.0',
      'v250829098.0.10',
      'v0.15.1',
      'v250829098.0.9',
      'v0.14.1',
      'v250829098.0.4',
    ]);
  });
});

describe('package manifest', () => {
  const manifest = hermesBinPackageManifest({
    platform: { os: 'darwin', cpu: 'arm64' },
    version: '250829098.0.16',
    tag: 'hermes-v250829098.0.16',
    engine: 'v1',
  });

  it('is versioned by the Hermes version, not the Argus version', () => {
    expect(manifest.version).toBe('250829098.0.16');
  });

  it('gates installation on the matching os and cpu', () => {
    expect(manifest.os).toEqual(['darwin']);
    expect(manifest.cpu).toEqual(['arm64']);
  });

  it('ships only the bin directory', () => {
    expect(manifest.files).toEqual(['bin']);
  });

  it('declares no entry point, because it ships executables and not modules', () => {
    expect(manifest).not.toHaveProperty('main');
    expect(manifest).not.toHaveProperty('types');
    expect(manifest).not.toHaveProperty('exports');
  });

  it('records the tag it was built from so the payload is traceable', () => {
    expect(manifest.description).toContain('hermes-v250829098.0.16');
  });

  it('names the engine so a legacy build is not mistaken for a V1 one', () => {
    const legacy = hermesBinPackageManifest({
      platform: { os: 'linux', cpu: 'x64' },
      version: '0.17.0',
      tag: 'hermes-v0.17.0',
      engine: 'legacy',
    });

    expect(manifest.description).toContain('Hermes V1');
    expect(legacy.description).toContain('Hermes legacy');
  });

  it('carries complete publish metadata', () => {
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/malopezr7/argus.git',
    });
    expect(manifest.name).toBe('@argus/hermes-bin-darwin-arm64');
  });
});

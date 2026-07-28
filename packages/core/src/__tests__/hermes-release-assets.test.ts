import { describe, expect, it } from 'vitest';
import { HERMES_PINS_BY_RN_MINOR } from '../domain/hermes-pins.js';
import {
  ARGUS_REPOSITORY,
  HERMES_BIN_PLATFORMS,
  HERMES_CHECKSUMS_ASSET,
  hermesAssetName,
  hermesAssetUrl,
  hermesChecksumAssetName,
  hermesReleaseNotes,
  hermesReleasePlatform,
  hermesReleaseTag,
  hermesReleaseVersion,
} from '../domain/hermes-release-assets.js';

describe('release versions', () => {
  it('strips the tag prefix down to the bare version', () => {
    expect(hermesReleaseVersion('hermes-v250829098.0.16')).toBe('250829098.0.16');
    expect(hermesReleaseVersion('hermes-v0.17.0')).toBe('0.17.0');
  });

  it('accepts a bare version as readily as a full tag', () => {
    expect(hermesReleaseVersion('v250829098.0.16')).toBe('250829098.0.16');
    expect(hermesReleaseVersion('250829098.0.16')).toBe('250829098.0.16');
  });

  it('refuses a date-based ref, which cannot name a version', () => {
    expect(hermesReleaseVersion('hermes-2025-09-01-RNv0.82.0')).toBeUndefined();
  });

  it('refuses a bare commit SHA', () => {
    expect(hermesReleaseVersion('76dc3793')).toBeUndefined();
  });

  it('refuses an unparsable ref', () => {
    expect(hermesReleaseVersion('')).toBeUndefined();
    expect(hermesReleaseVersion('not-a-ref')).toBeUndefined();
  });

  it('publishes every semver pin in the RN table', () => {
    // The pins that are not semver (date tags, the 0.82 V1 SHA) are exactly the
    // ones this scheme cannot publish, and the guard must agree with the table.
    const refs = Object.values(HERMES_PINS_BY_RN_MINOR).flatMap((pins) =>
      [pins.legacy, pins.v1].filter((ref) => ref !== undefined),
    );
    const publishable = refs.filter((ref) => hermesReleaseVersion(ref) !== undefined);

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

describe('release tags', () => {
  it('names the release after the Hermes version', () => {
    expect(hermesReleaseTag('hermes-v250829098.0.16')).toBe('hermes-bin-v250829098.0.16');
    expect(hermesReleaseTag('hermes-v0.17.0')).toBe('hermes-bin-v0.17.0');
  });

  it('cannot be confused with an Argus release tag', () => {
    // Argus tags its own releases `v0.1.0` on this same repository, so a prefix
    // match has to separate the two namespaces with no further parsing.
    const tag = hermesReleaseTag('hermes-v0.17.0');

    expect(tag).not.toMatch(/^v\d/);
    expect(tag?.startsWith('hermes-bin-v')).toBe(true);
  });

  it('carries no slash, so it stays unambiguous in an asset URL path', () => {
    expect(hermesReleaseTag('hermes-v250829098.0.16')).not.toContain('/');
  });

  it('has no tag for a ref that cannot name a version', () => {
    expect(hermesReleaseTag('hermes-2025-09-01-RNv0.82.0')).toBeUndefined();
    expect(hermesReleaseTag('76dc3793')).toBeUndefined();
    expect(hermesReleaseTag('not-a-ref')).toBeUndefined();
  });
});

describe('asset names', () => {
  it('names an archive after its version and platform', () => {
    expect(hermesAssetName({ os: 'darwin', cpu: 'arm64' }, '250829098.0.16')).toBe(
      'hermes-250829098.0.16-darwin-arm64.tar.gz',
    );
    expect(hermesAssetName({ os: 'linux', cpu: 'x64' }, '0.17.0')).toBe(
      'hermes-0.17.0-linux-x64.tar.gz',
    );
  });

  it('gives every published platform a distinct asset in one release', () => {
    const names = HERMES_BIN_PLATFORMS.map((platform) =>
      hermesAssetName(platform, '250829098.0.16'),
    );

    expect(new Set(names).size).toBe(HERMES_BIN_PLATFORMS.length);
  });

  it('publishes the four P0 targets and no others', () => {
    expect(HERMES_BIN_PLATFORMS.map((platform) => hermesAssetName(platform, '1.0.0'))).toEqual([
      'hermes-1.0.0-darwin-arm64.tar.gz',
      'hermes-1.0.0-darwin-x64.tar.gz',
      'hermes-1.0.0-linux-x64.tar.gz',
      'hermes-1.0.0-linux-arm64.tar.gz',
    ]);
  });

  it('names the checksum file after the asset it covers', () => {
    expect(hermesChecksumAssetName('hermes-1.0.0-linux-x64.tar.gz')).toBe(
      'hermes-1.0.0-linux-x64.tar.gz.sha256',
    );
  });

  it('has an aggregate checksum file alongside the per-asset ones', () => {
    expect(HERMES_CHECKSUMS_ASSET).toBe('checksums.txt');
  });
});

describe('asset URLs', () => {
  it('points at the public release download path', () => {
    expect(
      hermesAssetUrl('hermes-bin-v250829098.0.16', 'hermes-250829098.0.16-darwin-arm64.tar.gz'),
    ).toBe(
      'https://github.com/malopezr7/argus/releases/download/hermes-bin-v250829098.0.16/' +
        'hermes-250829098.0.16-darwin-arm64.tar.gz',
    );
  });
});

describe('host platform matching', () => {
  it('matches a published host', () => {
    expect(hermesReleasePlatform('darwin', 'arm64')).toEqual({ os: 'darwin', cpu: 'arm64' });
    expect(hermesReleasePlatform('linux', 'x64')).toEqual({ os: 'linux', cpu: 'x64' });
  });

  it('reports no platform for a host nothing is published for', () => {
    expect(hermesReleasePlatform('win32', 'x64')).toBeUndefined();
    expect(hermesReleasePlatform('linux', 'ppc64')).toBeUndefined();
    expect(hermesReleasePlatform('freebsd', 'arm64')).toBeUndefined();
  });
});

describe('release notes', () => {
  const notes = hermesReleaseNotes({
    tag: 'hermes-v250829098.0.16',
    engine: 'v1',
    version: '250829098.0.16',
  });

  it('records the tag and engine it was built from', () => {
    expect(notes).toContain('hermes-v250829098.0.16');
    expect(notes).toContain('Hermes V1');
  });

  it('names the engine so a legacy build is not mistaken for a V1 one', () => {
    const legacy = hermesReleaseNotes({
      tag: 'hermes-v0.17.0',
      engine: 'legacy',
      version: '0.17.0',
    });

    expect(legacy).toContain('Hermes legacy');
    expect(legacy).not.toContain('Hermes V1');
  });

  it('lists every asset the release carries', () => {
    for (const platform of HERMES_BIN_PLATFORMS) {
      expect(notes).toContain(hermesAssetName(platform, '250829098.0.16'));
    }
  });

  it('says the assets are consumed automatically rather than installed by hand', () => {
    expect(notes).toContain('do not need to download these by hand');
    expect(notes).toContain('fetches the right one at run');
  });

  it('tells a human how to verify the checksums', () => {
    expect(notes).toContain(`shasum -a 256 -c ${HERMES_CHECKSUMS_ASSET}`);
  });

  it('tells a human how to verify provenance, against the repository that publishes', () => {
    expect(notes).toContain('gh attestation verify');
    expect(notes).toContain(`--repo ${ARGUS_REPOSITORY}`);
  });

  it('names a real published asset in the verify example', () => {
    // A copy-pasteable command is worth nothing if it names an asset the
    // release does not carry, so the example has to be one of the real ones.
    const named = HERMES_BIN_PLATFORMS.map((platform) =>
      hermesAssetName(platform, '250829098.0.16'),
    );
    const example = /gh attestation verify (\S+)/.exec(notes)?.[1];

    expect(example).toBeDefined();
    expect(named).toContain(example);
  });

  it('says why provenance is not the same guarantee as a checksum', () => {
    expect(notes).toContain('cannot say who built it');
  });
});

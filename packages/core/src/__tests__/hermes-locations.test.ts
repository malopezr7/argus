import { describe, expect, it } from 'vitest';
import {
  ARGUS_CACHE_SEGMENTS,
  BUNDLED_LEGACY_VM_SEGMENTS,
  hermesCacheBinarySegments,
  hermesCacheRootSegments,
} from '../domain/hermes-locations.js';

describe('cache layout', () => {
  it('roots the cache at ~/.argus/cache', () => {
    expect(ARGUS_CACHE_SEGMENTS).toEqual(['.argus', 'cache']);
  });

  it('names a build directory after the tag verbatim', () => {
    expect(hermesCacheRootSegments('hermes-v250829098.0.16')).toEqual([
      '.argus',
      'cache',
      'hermes-hermes-v250829098.0.16',
    ]);
  });

  it('places the built binary under build/bin/hermes', () => {
    expect(hermesCacheBinarySegments('hermes-v0.17.0')).toEqual([
      '.argus',
      'cache',
      'hermes-hermes-v0.17.0',
      'build',
      'bin',
      'hermes',
    ]);
  });

  it('keeps the binary path under its own root so writer and reader agree', () => {
    const root = hermesCacheRootSegments('hermes-v0.17.0');
    const binary = hermesCacheBinarySegments('hermes-v0.17.0');

    expect(binary.slice(0, root.length)).toEqual(root);
  });

  it('gives each engine its own cache directory', () => {
    expect(hermesCacheRootSegments('hermes-v0.17.0')).not.toEqual(
      hermesCacheRootSegments('hermes-v250829098.0.16'),
    );
  });
});

describe('bundled legacy VM', () => {
  it('points at the VM, not the sibling compiler', () => {
    expect(BUNDLED_LEGACY_VM_SEGMENTS).toEqual(['sdks', 'hermesc', 'osx-bin', 'hermes']);
    expect(BUNDLED_LEGACY_VM_SEGMENTS.at(-1)).toBe('hermes');
  });
});

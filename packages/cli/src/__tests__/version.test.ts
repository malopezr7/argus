import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MANIFEST_CANDIDATES,
  missingManifestMessage,
  PUBLISHED_NAME,
  resolvePackageVersion,
  selectPackageVersion,
} from '../version.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** A reader over a fixed file map, standing in for the disk. */
function readerFor(files: Record<string, string>): (path: string) => string | undefined {
  return (path) => files[path];
}

function manifest(name: string, version: string): string {
  return JSON.stringify({ name, version });
}

describe('selectPackageVersion', () => {
  /**
   * Installed, the CLI is one bundled file at `<pkg>/bin/argus.js`, so the
   * manifest is one directory up. This is the layout that actually ships, and
   * the one a source-only test would never exercise.
   */
  it('reads the manifest beside the binary in an installed package', () => {
    const files = {
      '/app/node_modules/@arguslab/argus/package.json': manifest(PUBLISHED_NAME, '9.9.9'),
    };

    expect(selectPackageVersion('/app/node_modules/@arguslab/argus/bin', readerFor(files))).toBe(
      '9.9.9',
    );
  });

  /**
   * From source there is no installed manifest; the version lives in the
   * packaging manifest the build copies into the tarball. Both layouts
   * therefore read the SAME file — one directly, one through the copy — so the
   * two cannot disagree about what version this is.
   */
  it('reads the packaging manifest when running from source', () => {
    const files = { '/repo/packaging/package.json': manifest(PUBLISHED_NAME, '1.2.3') };

    expect(selectPackageVersion('/repo/packages/cli/src', readerFor(files))).toBe('1.2.3');
  });

  /**
   * A package.json that happens to sit one level up is not evidence. Installed
   * under a consumer's own tree, the wrong answer is right there — and
   * reporting the consumer's version as Argus's would be worse than reporting
   * nothing.
   */
  it('rejects a manifest that belongs to some other package', () => {
    const files = { '/somewhere/package.json': manifest('their-app', '4.5.6') };

    expect(selectPackageVersion('/somewhere/bin', readerFor(files))).toBeUndefined();
  });

  it('rejects a manifest with no usable version', () => {
    const files = { '/pkg/package.json': JSON.stringify({ name: PUBLISHED_NAME }) };

    expect(selectPackageVersion('/pkg/bin', readerFor(files))).toBeUndefined();
  });

  it('rejects a manifest that is not valid JSON', () => {
    const files = { '/pkg/package.json': '{ not json' };

    expect(selectPackageVersion('/pkg/bin', readerFor(files))).toBeUndefined();
  });

  it('finds nothing when no candidate exists', () => {
    expect(selectPackageVersion('/nowhere', readerFor({}))).toBeUndefined();
  });
});

describe('missingManifestMessage', () => {
  it('names every path it probed, so a broken install is diagnosable', () => {
    const message = missingManifestMessage('/pkg/bin');

    for (const segments of MANIFEST_CANDIDATES) {
      expect(message).toContain(join('/pkg/bin', ...segments));
    }
  });
});

/**
 * The number `--version` prints is the number npm published. Anything else — a
 * constant in a source file, a value baked in at build time — is a second place
 * to remember, and the one nobody updates.
 */
describe('resolvePackageVersion', () => {
  it('reports the version the published manifest declares', () => {
    const published = JSON.parse(readFileSync(join(REPO, 'packaging', 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };

    expect(published.name).toBe(PUBLISHED_NAME);
    expect(resolvePackageVersion()).toBe(published.version);
  });

  it('reports a version, not a placeholder', () => {
    expect(resolvePackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

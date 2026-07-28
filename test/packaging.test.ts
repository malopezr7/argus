import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface PackageJson {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  files?: string[];
  bin?: Record<string, string>;
  engines?: Record<string, string>;
}

function readJson(...segments: string[]): PackageJson {
  return JSON.parse(readFileSync(join(REPO, ...segments), 'utf8')) as PackageJson;
}

const published = readJson('packaging', 'package.json');

const workspacePackages = readdirSync(join(REPO, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ dir: entry.name, pkg: readJson('packages', entry.name, 'package.json') }));

/**
 * Exactly one artifact reaches npm. Every workspace package is an internal seam:
 * `core` and the adapters are a hexagonal boundary rather than an API, and
 * `framework` and `rntl` are Hermes-side sources that are never imported by Node
 * at all. Publishing any of them would freeze an internal boundary into a public
 * contract by accident.
 */
describe('publishable surface', () => {
  it('marks every workspace package private', () => {
    const publishable = workspacePackages.filter(({ pkg }) => pkg.private !== true);

    expect(publishable.map(({ pkg }) => pkg.name)).toEqual([]);
  });

  it('publishes one package, exposing a bin named argus', () => {
    expect(published.name).toBe('@arguslab/argus');
    expect(published.bin).toEqual({ argus: './bin/argus.js' });
  });

  it('ships only the binary, the runtime assets and the types', () => {
    expect(published.files).toEqual(['bin', 'runtime', 'types', 'README.md', 'LICENSE']);
  });

  it('states the Node floor it is built for', () => {
    expect(published.engines?.node).toBe('>=24');
  });
});

/**
 * The bundle externalises exactly the packages that cannot be inlined. If the
 * manifest and the bundle ever disagree, the package installs cleanly and then
 * dies on first run with a bare module-resolution error — so the two are pinned
 * to each other here rather than left to drift.
 */
describe('published dependencies', () => {
  /** Non-workspace dependencies of the packages bundled into the binary. */
  const hostDependencies = new Map<string, string>();
  for (const { pkg } of workspacePackages) {
    // framework and rntl run on Hermes, not Node: their dependencies are the
    // user's to install, not ours to bundle.
    if (pkg.name === '@arguslab/framework' || pkg.name === '@arguslab/rntl') continue;
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      if (!name.startsWith('@arguslab/')) hostDependencies.set(name, range);
    }
  }

  it('declares every external dependency the bundled host code has', () => {
    expect(Object.keys(published.dependencies ?? {}).sort()).toEqual(
      [...hostDependencies.keys()].sort(),
    );
  });

  it('declares them at the same version range the workspace resolved', () => {
    for (const [name, range] of hostDependencies) {
      expect(published.dependencies?.[name], `range for ${name}`).toBe(range);
    }
  });

  it('declares no workspace protocol ranges, which npm cannot resolve', () => {
    const ranges = Object.values(published.dependencies ?? {});
    expect(ranges.filter((range) => range.startsWith('workspace:'))).toEqual([]);
  });
});

/**
 * React and the renderer belong to the project under test. Declaring them as
 * OPTIONAL peers is what keeps a pure-TypeScript suite installable with no React
 * anywhere: a plain dependency on the renderer would drag React in through its
 * own peer range, which npm installs automatically.
 */
describe('component-testing peers', () => {
  it('asks for React and the renderer as peers, never as dependencies', () => {
    expect(Object.keys(published.peerDependencies ?? {}).sort()).toEqual([
      'react',
      'test-renderer',
    ]);
    expect(published.dependencies?.react).toBeUndefined();
    expect(published.dependencies?.['test-renderer']).toBeUndefined();
  });

  it('marks both optional so a suite with no components still installs', () => {
    expect(published.peerDependenciesMeta?.react?.optional).toBe(true);
    expect(published.peerDependenciesMeta?.['test-renderer']?.optional).toBe(true);
  });

  it('accepts the renderer version the component layer is written against', () => {
    const rntl = workspacePackages.find(({ pkg }) => pkg.name === '@arguslab/rntl');

    expect(published.peerDependencies?.['test-renderer']).toBe(
      rntl?.pkg.dependencies?.['test-renderer'],
    );
  });
});

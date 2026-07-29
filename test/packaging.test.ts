import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, HERMES_CONFIG_KEYS } from '../packages/cli/src/config/validate.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface PackageJson {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  files?: string[];
  bin?: Record<string, string>;
  types?: string;
  exports?: Record<string, unknown>;
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

  it('ships the binary, the runtime assets, the importable entry and the types', () => {
    expect(published.files).toEqual(['bin', 'lib', 'runtime', 'types', 'README.md', 'LICENSE']);
  });

  it('states the Node floor it is built for', () => {
    expect(published.engines?.node).toBe('>=24');
  });
});

/**
 * `defineConfig` has to be importable, which means the package needs a real
 * Node entry point and not just a `bin`. Without one,
 * `import { defineConfig } from '@arguslab/argus'` fails at resolution —
 * the config file cannot be typed, and the whole config layer is unusable from
 * an installed package however well it works from source.
 */
describe('the importable entry point', () => {
  const entry = published.exports?.['.'] as Record<string, string> | undefined;

  it('exposes a subpath-exports map with a root entry', () => {
    expect(entry).toBeDefined();
  });

  it('points at an emitted JavaScript module', () => {
    expect(entry?.import).toBe('./lib/index.js');
  });

  it('points at declarations that describe that module', () => {
    expect(entry?.types).toBe('./types/index.d.ts');
  });

  /**
   * Under node16/nodenext resolution the exports map governs `types` too, so
   * the legacy top-level field must agree with it. Pointing the two at
   * different files is how a package typechecks under one resolution mode and
   * not the other.
   */
  it('agrees with the legacy top-level types field', () => {
    expect(published.types).toBe(entry?.types);
  });

  /**
   * Tooling reads a dependency's own package.json (npm, bundlers, `require.resolve`).
   * An exports map without this entry makes that a hard error.
   */
  it('keeps package.json itself resolvable', () => {
    expect(published.exports?.['./package.json']).toBe('./package.json');
  });
});

/**
 * The declarations are written by hand rather than generated, so the realistic
 * failure is adding an option to the config contract and forgetting to declare
 * it — leaving a documented option that does not typecheck for the user.
 */
describe('the published declarations', () => {
  const declarations = readFileSync(join(REPO, 'packaging', 'index.d.ts'), 'utf8');

  it('declares every option the validator accepts', () => {
    for (const key of CONFIG_KEYS) {
      expect(declarations, `ArgusConfig should declare "${key}"`).toContain(`${key}?:`);
    }
  });

  it('declares every hermes option the validator accepts', () => {
    for (const key of HERMES_CONFIG_KEYS) {
      expect(declarations, `ArgusHermesConfig should declare "${key}"`).toContain(`${key}?:`);
    }
  });

  it('exports defineConfig and the config type', () => {
    expect(declarations).toContain('defineConfig');
    expect(declarations).toContain('ArgusConfig');
  });

  /**
   * `argus.d.ts` declares the test GLOBALS, and only works because it has no
   * top-level import or export. Referencing it from the module entry keeps a
   * single `types: ["@arguslab/argus"]` delivering both, without turning it
   * into a module and silently dropping every global.
   */
  it('pulls in the ambient globals so one types entry delivers both', () => {
    expect(declarations).toContain('/// <reference path="./argus.d.ts" />');
    expect(existsSync(join(REPO, 'packaging', 'argus.d.ts'))).toBe(true);
  });

  /**
   * Only a COLUMN-ZERO import or export makes the file a module. The indented
   * `export`s inside `declare module 'argus' { ... }` are the ambient module's
   * own members and are exactly what should be there.
   */
  it('leaves argus.d.ts a global script, with no top-level import or export', () => {
    const globals = readFileSync(join(REPO, 'packaging', 'argus.d.ts'), 'utf8');

    expect(globals).not.toMatch(/^(import|export)\s/m);
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

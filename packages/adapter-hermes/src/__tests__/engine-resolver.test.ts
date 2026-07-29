import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveHermesEngine } from '../engine-resolver.js';

/**
 * Fixtures are built at test time under the OS temp dir. They are never
 * committed: the repo's .gitignore ignores `node_modules` everywhere, and a
 * fixture tree of that shape would need an exception.
 */

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

interface FakeReactNative {
  versionProperties?: string;
  /** `sdks/.hermesv1version` — the real, lowercase filename. */
  hermesV1Version?: string;
  /** `sdks/.hermesV1version` — the misspelling this module must NOT read. */
  capitalisedHermesV1Version?: string;
  hermesVersion?: string;
  packageJson?: Record<string, unknown> | string;
}

/** Create a temp project containing `node_modules/react-native/`. */
function createProject(spec: FakeReactNative = {}): string {
  const root = createBareDir();
  const reactNative = join(root, 'node_modules', 'react-native');
  const sdks = join(reactNative, 'sdks');
  mkdirSync(sdks, { recursive: true });

  if (spec.versionProperties !== undefined) {
    mkdirSync(join(sdks, 'hermes-engine'), { recursive: true });
    writeFileSync(join(sdks, 'hermes-engine', 'version.properties'), spec.versionProperties);
  }
  if (spec.hermesV1Version !== undefined) {
    writeFileSync(join(sdks, '.hermesv1version'), spec.hermesV1Version);
  }
  if (spec.capitalisedHermesV1Version !== undefined) {
    writeFileSync(join(sdks, '.hermesV1version'), spec.capitalisedHermesV1Version);
  }
  if (spec.hermesVersion !== undefined) {
    writeFileSync(join(sdks, '.hermesversion'), spec.hermesVersion);
  }
  if (spec.packageJson !== undefined) {
    const body =
      typeof spec.packageJson === 'string' ? spec.packageJson : JSON.stringify(spec.packageJson);
    writeFileSync(join(reactNative, 'package.json'), body);
  }
  return root;
}

/** Create a temp dir with no React Native install anywhere inside it. */
function createBareDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'argus-engine-'));
  tempRoots.push(root);
  return root;
}

/** True when the filesystem treats `.hermesv1version` and `.hermesV1version` as one file. */
function isCaseInsensitiveFs(dir: string): boolean {
  const probe = join(dir, '.argus-case-probe');
  writeFileSync(probe, '');
  const collides = existsSync(join(dir, '.ARGUS-CASE-PROBE'));
  rmSync(probe);
  return collides;
}

const RN_086_PROPERTIES = 'HERMES_VERSION_NAME=0.17.0\nHERMES_V1_VERSION_NAME=250829098.0.16\n';

describe('resolveHermesEngine', () => {
  /**
   * The engine a project resolves to must be the one its React Native SHIPS,
   * not merely one it pins. RN 0.82 and 0.83 pin both engines and ship legacy —
   * V1 was an experimental opt-in needing a from-source build. Running V1 there
   * would report results from a VM the app never executes.
   *
   * One row per published release, because a suite that only covered 0.86
   * passed while 0.82 and 0.83 were silently wrong.
   */
  describe("resolves the engine the project's React Native ships by default", () => {
    const rows = [
      { rn: '0.78.0', legacy: '2025-01-13-RNv0.78.0', v1: undefined, engine: 'legacy' },
      { rn: '0.79.3', legacy: '2025-06-04-RNv0.79.3', v1: undefined, engine: 'legacy' },
      { rn: '0.80.2', legacy: '2025-07-24-RNv0.80.2', v1: undefined, engine: 'legacy' },
      { rn: '0.81.0', legacy: '2025-07-07-RNv0.81.0', v1: undefined, engine: 'legacy' },
      { rn: '0.82.1', legacy: '2025-09-01-RNv0.82.0', v1: '76dc3793', engine: 'legacy' },
      { rn: '0.83.4', legacy: '0.14.1', v1: '250829098.0.4', engine: 'legacy' },
      { rn: '0.84.0', legacy: '0.15.1', v1: '250829098.0.9', engine: 'v1' },
      { rn: '0.85.0', legacy: '0.16.0', v1: '250829098.0.10', engine: 'v1' },
      { rn: '0.86.2', legacy: '0.17.0', v1: '250829098.0.16', engine: 'v1' },
      { rn: '0.87.0', legacy: undefined, v1: '250829098.0.16', engine: 'v1' },
    ] as const;

    /** The `version.properties` such a release would ship. */
    function propertiesFor(row: (typeof rows)[number]): string {
      const lines: string[] = [];
      if (row.legacy !== undefined) lines.push(`HERMES_VERSION_NAME=${row.legacy}`);
      if (row.v1 !== undefined) lines.push(`HERMES_V1_VERSION_NAME=${row.v1}`);
      return `${lines.join('\n')}\n`;
    }

    it.each(rows)('RN $rn runs on $engine', (row) => {
      const startDir = createProject({
        versionProperties: propertiesFor(row),
        packageJson: { version: row.rn },
      });

      const outcome = resolveHermesEngine({ startDir });

      expect(outcome.kind).toBe('resolved');
      expect(outcome.kind === 'resolved' && outcome.resolution.ref.engine).toBe(row.engine);
    });

    it.each(rows.filter((r) => r.legacy !== undefined && r.v1 !== undefined))(
      'RN $rn does not flag an assumption — its default is known',
      (row) => {
        const startDir = createProject({
          versionProperties: propertiesFor(row),
          packageJson: { version: row.rn },
        });

        const outcome = resolveHermesEngine({ startDir });

        expect(outcome.kind === 'resolved' && outcome.resolution.assumedDefault).toBeUndefined();
      },
    );

    it('still reaches V1 on RN 0.83 when the user opts in with --engine v1', () => {
      const startDir = createProject({
        versionProperties: 'HERMES_VERSION_NAME=0.14.1\nHERMES_V1_VERSION_NAME=250829098.0.4\n',
        packageJson: { version: '0.83.4' },
      });

      expect(resolveHermesEngine({ startDir, engine: 'v1' })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'v1', version: '250829098.0.4' } },
      });
    });

    it('picks the pinned engine when the default one is missing from the files', () => {
      // RN 0.84 ships v1, but this install exposes only a legacy pin. One
      // engine is available and it is the one that runs.
      const startDir = createProject({
        versionProperties: 'HERMES_VERSION_NAME=0.15.1\n',
        packageJson: { version: '0.84.0' },
      });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'legacy' } },
      });
    });
  });

  describe('an RN release outside the table', () => {
    const BOTH = 'HERMES_VERSION_NAME=0.17.0\nHERMES_V1_VERSION_NAME=250829098.0.16\n';

    it('assumes v1 and flags the assumption when both engines are pinned', () => {
      const startDir = createProject({
        versionProperties: BOTH,
        packageJson: { version: '0.99.0' },
      });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'v1' }, assumedDefault: true },
      });
    });

    it('flags the assumption when the install reports no version at all', () => {
      const startDir = createProject({ versionProperties: BOTH });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'v1' }, assumedDefault: true },
      });
    });

    it('does not flag an assumption when only one engine is pinned', () => {
      const startDir = createProject({
        versionProperties: 'HERMES_VERSION_NAME=0.17.0\n',
        packageJson: { version: '0.99.0' },
      });

      const outcome = resolveHermesEngine({ startDir });

      expect(outcome.kind === 'resolved' && outcome.resolution.assumedDefault).toBeUndefined();
    });
  });

  describe('version.properties (RN 0.82+)', () => {
    it('reads both engines and defaults to v1', () => {
      const startDir = createProject({
        versionProperties: RN_086_PROPERTIES,
        packageJson: { version: '0.86.2' },
      });

      expect(resolveHermesEngine({ startDir })).toEqual({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'v1', tag: 'hermes-v250829098.0.16', version: '250829098.0.16' },
          source: 'version.properties',
          rnVersion: '0.86.2',
        },
        reactNativeDir: join(startDir, 'node_modules', 'react-native'),
      });
    });

    it('reports the install directory so callers can reach files inside it', () => {
      const startDir = createProject({
        versionProperties: RN_086_PROPERTIES,
        packageJson: { version: '0.86.2' },
      });

      const outcome = resolveHermesEngine({ startDir });

      expect(outcome.kind).toBe('resolved');
      expect(outcome.kind === 'resolved' && outcome.reactNativeDir).toBe(
        join(startDir, 'node_modules', 'react-native'),
      );
    });

    it('serves the legacy engine from the same file on request', () => {
      const startDir = createProject({ versionProperties: RN_086_PROPERTIES });

      expect(resolveHermesEngine({ startDir, engine: 'legacy' })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'legacy', tag: 'hermes-v0.17.0', version: '0.17.0' },
          source: 'version.properties',
        },
      });
    });

    it('takes precedence over the standalone version files', () => {
      const startDir = createProject({
        versionProperties: RN_086_PROPERTIES,
        hermesV1Version: 'hermes-v250829098.0.4',
        hermesVersion: 'hermes-v0.14.1',
      });

      const outcome = resolveHermesEngine({ startDir });
      expect(outcome).toMatchObject({
        kind: 'resolved',
        resolution: { source: 'version.properties', ref: { version: '250829098.0.16' } },
      });
    });
  });

  describe('.hermesv1version (RN 0.83+)', () => {
    it('resolves v1 from the file alone', () => {
      const startDir = createProject({ hermesV1Version: 'hermes-v250829098.0.16\n' });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'v1', tag: 'hermes-v250829098.0.16', version: '250829098.0.16' },
          source: 'hermesv1version',
          rnVersion: undefined,
        },
      });
    });

    it('trusts the filename over the tag shape for a commit-sha pin', () => {
      const startDir = createProject({ hermesV1Version: '76dc3793\n' });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'v1', tag: '76dc3793', version: '76dc3793' },
          source: 'hermesv1version',
        },
      });
    });
  });

  describe('.hermesversion (RN 0.69+)', () => {
    it('resolves the legacy engine from a semver tag', () => {
      const startDir = createProject({ hermesVersion: 'hermes-v0.17.0\n' });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'legacy', tag: 'hermes-v0.17.0', version: '0.17.0' },
          source: 'hermesversion',
        },
      });
    });

    it('resolves the legacy engine from a date-based tag', () => {
      const raw = 'hermes-2025-07-24-RNv0.80.2-5c7dbc0a78cb2d2a8bc81c41c617c3abecf209ff';
      const startDir = createProject({ hermesVersion: `${raw}\n` });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'legacy', tag: raw },
          source: 'hermesversion',
        },
      });
    });

    it('classifies by tag shape, so a v1-shaped tag is filed as v1', () => {
      // This source is not hinted: if RN ever moves a V1 pin here, it
      // self-corrects instead of being mislabelled by provenance.
      const startDir = createProject({ hermesVersion: 'hermes-v250829098.0.16\n' });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'v1' }, source: 'hermesversion' },
      });
    });
  });

  describe('hermes-compiler dependency (RN 0.83+)', () => {
    it('resolves v1 from the dependency version', () => {
      const startDir = createProject({
        packageJson: { dependencies: { 'hermes-compiler': '250829098.0.16' } },
      });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'v1', version: '250829098.0.16' },
          source: 'hermes-compiler',
        },
      });
    });

    it('strips npm range operators', () => {
      const startDir = createProject({
        packageJson: { dependencies: { 'hermes-compiler': '^250829098.0.16' } },
      });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { version: '250829098.0.16' }, source: 'hermes-compiler' },
      });
    });

    it('ranks below the sdks files', () => {
      const startDir = createProject({
        hermesV1Version: 'hermes-v250829098.0.4',
        packageJson: { dependencies: { 'hermes-compiler': '250829098.0.16' } },
      });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { version: '250829098.0.4' }, source: 'hermesv1version' },
      });
    });
  });

  describe('upward walk', () => {
    it('finds an install from a nested subdirectory', () => {
      const root = createProject({ hermesV1Version: 'hermes-v250829098.0.16' });
      const nested = join(root, 'apps', 'mobile', 'src', '__tests__');
      mkdirSync(nested, { recursive: true });

      expect(resolveHermesEngine({ startDir: nested })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { version: '250829098.0.16' }, source: 'hermesv1version' },
      });
    });

    it('takes the nearest install when several are nested', () => {
      const outer = createProject({ hermesVersion: 'hermes-v0.14.1' });
      const inner = join(outer, 'packages', 'app');
      mkdirSync(join(inner, 'node_modules', 'react-native', 'sdks'), { recursive: true });
      writeFileSync(
        join(inner, 'node_modules', 'react-native', 'sdks', '.hermesv1version'),
        'hermes-v250829098.0.16',
      );

      expect(resolveHermesEngine({ startDir: inner })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { version: '250829098.0.16' }, source: 'hermesv1version' },
      });
    });
  });

  describe('nothing found', () => {
    it('reports unresolved when there is no install and no RN version', () => {
      const startDir = createBareDir();

      expect(resolveHermesEngine({ startDir })).toEqual({
        kind: 'unresolved',
        reason: 'no-react-native-install',
      });
    });

    it('reports unresolved when an install pins nothing and declares no version', () => {
      const startDir = createProject();

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'unresolved',
        reason: 'no-pins-found',
      });
    });

    it('does not throw for the not-found case', () => {
      const startDir = createBareDir();
      expect(() => resolveHermesEngine({ startDir })).not.toThrow();
    });

    it('ignores unparsable pins', () => {
      const startDir = createProject({ hermesV1Version: 'not-a-version\n' });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'unresolved',
        reason: 'no-pins-found',
      });
    });

    it('survives a malformed react-native package.json', () => {
      const startDir = createProject({
        hermesV1Version: 'hermes-v250829098.0.16',
        packageJson: '{ this is not json',
      });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { version: '250829098.0.16' } },
      });
    });
  });

  describe('fallback table', () => {
    it('uses the caller-supplied RN version when no install exists', () => {
      const startDir = createBareDir();

      expect(resolveHermesEngine({ startDir, rnVersion: '0.86.2' })).toEqual({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'v1', tag: 'hermes-v250829098.0.16', version: '250829098.0.16' },
          source: 'fallback-table',
          rnVersion: '0.86.2',
        },
      });
    });

    it("uses an install's own version when it pins nothing", () => {
      const startDir = createProject({ packageJson: { version: '0.84.0' } });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: {
          ref: { engine: 'v1', version: '250829098.0.9' },
          source: 'fallback-table',
          rnVersion: '0.84.0',
        },
      });
    });

    it('stays unresolved for an RN version outside the table', () => {
      const startDir = createBareDir();

      expect(resolveHermesEngine({ startDir, rnVersion: '0.60.0' })).toMatchObject({
        kind: 'unresolved',
        reason: 'no-pins-found',
        rnVersion: '0.60.0',
      });
    });

    it('reports unavailable for an engine the RN release never shipped', () => {
      const startDir = createBareDir();

      expect(
        resolveHermesEngine({ startDir, rnVersion: '0.87.0', engine: 'legacy' }),
      ).toMatchObject({ kind: 'unavailable', requested: 'legacy', available: ['v1'] });
    });
  });

  describe('engine preference', () => {
    it('reports unavailable instead of silently serving the other engine', () => {
      const startDir = createProject({ hermesVersion: 'hermes-v0.17.0' });

      expect(resolveHermesEngine({ startDir, engine: 'v1' })).toMatchObject({
        kind: 'unavailable',
        requested: 'v1',
        available: ['legacy'],
      });
    });

    it('does not fall back to the table when the project pins the other engine', () => {
      // RN 0.86 pins a V1 engine in the table, but this install only declares
      // legacy. Upgrading silently would defeat the caller's warning.
      const startDir = createProject({
        hermesVersion: 'hermes-v0.17.0',
        packageJson: { version: '0.86.0' },
      });

      expect(resolveHermesEngine({ startDir, engine: 'v1' })).toMatchObject({
        kind: 'unavailable',
        requested: 'v1',
      });
    });
  });

  describe('.hermesv1version filename casing (regression)', () => {
    it('reads the lowercase filename React Native actually ships', () => {
      // Holds on every filesystem: the lowercase name is the only one written.
      const startDir = createProject({ hermesV1Version: 'hermes-v250829098.0.16' });

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'v1' }, source: 'hermesv1version' },
      });
    });

    it('does not treat a capital-V filename as a V1 source', (ctx) => {
      const startDir = createProject({
        capitalisedHermesV1Version: 'hermes-v250829098.0.16',
        hermesVersion: 'hermes-v0.17.0',
      });

      // On a case-insensitive filesystem (macOS APFS) `.hermesV1version` and
      // `.hermesv1version` are the same file, so this distinction cannot be
      // observed. Skipping keeps the assertion honest rather than vacuous; it
      // is the case-sensitive filesystems (Linux CI) that regress.
      if (isCaseInsensitiveFs(startDir)) {
        ctx.skip();
        return;
      }

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'resolved',
        resolution: { ref: { engine: 'legacy', version: '0.17.0' }, source: 'hermesversion' },
      });
    });

    it('finds no V1 pin when only the capital-V filename exists', (ctx) => {
      const startDir = createProject({ capitalisedHermesV1Version: 'hermes-v250829098.0.16' });

      if (isCaseInsensitiveFs(startDir)) {
        ctx.skip();
        return;
      }

      expect(resolveHermesEngine({ startDir })).toMatchObject({
        kind: 'unresolved',
        reason: 'no-pins-found',
      });
    });
  });
});

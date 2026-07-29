import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetResponse } from '@arguslab/hermes/prebuilt-assets.js';
import { sha256 } from '@arguslab/hermes/prebuilt-assets.js';
import { writeTarGz } from '@arguslab/hermes/tar.js';
import { afterAll, describe, expect, it } from 'vitest';
import { isExecutableFile, provisionHermes } from '../provision/provision.js';

/**
 * End-to-end provisioning against real temp fixtures: a fake React Native
 * install supplies the pins, and a shell script standing in for `hermes`
 * supplies the `--version` self-report the fidelity check reads.
 *
 * Fixtures are built at test time under the OS temp dir — a committed tree
 * containing `node_modules` would need a .gitignore exception.
 *
 * The prebuilt download boundary is injected in EVERY case, defaulting to "no
 * asset published". Without it these tests would reach github.com the moment
 * the chain got as far as the prebuilt step, which would make the suite depend
 * on the network and on what happens to be published at the time.
 */

const RN_BOTH_ENGINES = 'HERMES_VERSION_NAME=0.17.0\nHERMES_V1_VERSION_NAME=250829098.0.16\n';
const RN_V1_ONLY = 'HERMES_V1_VERSION_NAME=250829098.0.16\n';

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/**
 * An explicit binary path, tagged with the mechanism that named it.
 *
 * Which of `--hermes`, `ARGUS_HERMES` and the config file wins is settled by
 * `mergeConfig` (see config-merge.test.ts); by the time provisioning runs there
 * is one path and one origin, and the origin only decides what the summary line
 * calls it.
 */
function flag(path: string): { path: string; origin: 'flag' } {
  return { path, origin: 'flag' };
}

function env(path: string): { path: string; origin: 'env' } {
  return { path, origin: 'env' };
}

/** A temp project whose `node_modules/react-native` pins the given engines. */
function createProject(versionProperties?: string, rnVersion = '0.86.2'): string {
  const root = tempDir('argus-provision-');
  const reactNative = join(root, 'node_modules', 'react-native');
  mkdirSync(join(reactNative, 'sdks', 'hermes-engine'), { recursive: true });
  if (versionProperties !== undefined) {
    writeFileSync(
      join(reactNative, 'sdks', 'hermes-engine', 'version.properties'),
      versionProperties,
    );
  }
  writeFileSync(join(reactNative, 'package.json'), JSON.stringify({ version: rnVersion }));
  return root;
}

/**
 * An executable that answers `--version` the way Hermes does. Enough for the
 * adapter to read a release and bytecode version off a real subprocess.
 */
function createFakeHermes(releaseVersion: string, bytecodeVersion?: number): string {
  const dir = tempDir('argus-bin-');
  const path = join(dir, 'hermes');
  const bytecodeLine =
    bytecodeVersion === undefined ? '' : `echo "  HBC bytecode version: ${bytecodeVersion}"\n`;
  writeFileSync(
    path,
    `#!/bin/sh\necho "Hermes JavaScript compiler."\necho "  Hermes release version: ${releaseVersion}"\n${bytecodeLine}`,
  );
  chmodSync(path, 0o755);
  return path;
}

/** Nothing is published — the world every pre-release test runs in. */
const NOTHING_PUBLISHED = async (): Promise<AssetResponse> => ({ kind: 'not-found' });

/** Shared options; every test overrides only what it is about. */
function options(overrides: Record<string, unknown> = {}) {
  return {
    allowSourceBuild: false,
    startDir: tempDir('argus-empty-'),
    homeDir: tempDir('argus-home-'),
    platform: process.platform,
    arch: process.arch,
    fetchAsset: NOTHING_PUBLISHED,
    ...overrides,
  } as Parameters<typeof provisionHermes>[0];
}

describe('isExecutableFile', () => {
  it('rejects a path that does not exist', () => {
    expect(isExecutableFile(join(tempDir('argus-probe-'), 'nope'))).toBe(false);
  });

  it('rejects a directory', () => {
    expect(isExecutableFile(tempDir('argus-probe-'))).toBe(false);
  });

  it('rejects a file without the executable bit', () => {
    const path = join(tempDir('argus-probe-'), 'plain');
    writeFileSync(path, 'x');
    chmodSync(path, 0o644);

    expect(isExecutableFile(path)).toBe(false);
  });

  it('accepts an executable file', () => {
    expect(isExecutableFile(createFakeHermes('1.0.0'))).toBe(true);
  });
});

describe('provisionHermes — engine availability', () => {
  it('refuses --engine legacy when the project only pins v1', async () => {
    const result = await provisionHermes(
      options({ startDir: createProject(RN_V1_ONLY), engine: 'legacy' }),
    );

    expect(result.kind).toBe('usage-error');
    expect(result.kind === 'usage-error' && result.message).toContain('--engine legacy');
    expect(result.kind === 'usage-error' && result.message).toContain('v1');
  });

  it('does not substitute the other engine when the requested one is missing', async () => {
    const result = await provisionHermes(
      options({
        startDir: createProject(RN_V1_ONLY),
        engine: 'legacy',
        explicitHermes: flag(createFakeHermes('0.12.0', 96)),
      }),
    );

    expect(result.kind).toBe('usage-error');
  });

  it('serves the requested engine when the project pins it', async () => {
    const result = await provisionHermes(
      options({
        startDir: createProject(RN_BOTH_ENGINES),
        engine: 'legacy',
        explicitHermes: flag(createFakeHermes('0.17.0', 96)),
      }),
    );

    expect(result.kind).toBe('provisioned');
    expect(result.kind === 'provisioned' && result.summary).toContain('legacy hermes-v0.17.0');
  });
});

describe('provisionHermes — explicit paths', () => {
  it('uses --hermes and reports it as the source', async () => {
    const path = createFakeHermes('1.0.0', 98);
    const result = await provisionHermes(
      options({ startDir: createProject(RN_BOTH_ENGINES), explicitHermes: flag(path) }),
    );

    expect(result.kind).toBe('provisioned');
    expect(result.kind === 'provisioned' && result.summary).toContain('--hermes');
    expect(result.kind === 'provisioned' && result.binary.path).toBe(path);
  });

  it('names ARGUS_HERMES as the source when the environment supplied the path', async () => {
    const result = await provisionHermes(
      options({ explicitHermes: env(createFakeHermes('0.12.0', 96)) }),
    );

    expect(result.kind === 'provisioned' && result.summary).toContain('ARGUS_HERMES');
  });

  it('names the config file as the source when the config supplied the path', async () => {
    const result = await provisionHermes(
      options({
        explicitHermes: { path: createFakeHermes('0.12.0', 96), origin: 'config' },
      }),
    );

    expect(result.kind === 'provisioned' && result.summary).toContain('argus.config');
  });

  it('fails with the path the user named rather than falling back', async () => {
    const missing = join(tempDir('argus-missing-'), 'hermes');
    const result = await provisionHermes(options({ explicitHermes: flag(missing) }));

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.message).toContain(missing);
  });
});

describe('provisionHermes — fidelity', () => {
  it('warns when a legacy binary is used on a v1 project', async () => {
    const result = await provisionHermes(
      options({
        startDir: createProject(RN_V1_ONLY),
        explicitHermes: flag(createFakeHermes('0.12.0', 96)),
      }),
    );

    expect(result.kind).toBe('provisioned');
    expect(result.kind === 'provisioned' && result.warning).toContain('Engine mismatch');
    expect(result.kind === 'provisioned' && result.warning).toContain('targets v1');
  });

  it('stays silent when the binary matches the pinned engine', async () => {
    const result = await provisionHermes(
      options({
        startDir: createProject(RN_V1_ONLY),
        explicitHermes: flag(createFakeHermes('1.0.0', 98)),
      }),
    );

    expect(result.kind === 'provisioned' && result.warning).toBeUndefined();
  });

  it('stays silent when the binary reports no bytecode version', async () => {
    const result = await provisionHermes(
      options({
        startDir: createProject(RN_V1_ONLY),
        explicitHermes: flag(createFakeHermes('1.0.0')),
      }),
    );

    expect(result.kind === 'provisioned' && result.warning).toBeUndefined();
  });

  it('does not warn when the project pins nothing to be unfaithful to', async () => {
    const result = await provisionHermes(
      options({ explicitHermes: flag(createFakeHermes('0.12.0', 96)) }),
    );

    expect(result.kind === 'provisioned' && result.warning).toBeUndefined();
  });
});

describe('provisionHermes — prebuilt download', () => {
  // A fixed target rather than the host's, so the asset name is the same
  // wherever this suite runs.
  const HOST = { platform: 'linux', arch: 'x64' };
  const ASSET = 'hermes-250829098.0.16-linux-x64.tar.gz';

  /** Three executables answering `--version` the way Hermes V1 does. */
  function publishedArchive(): Buffer {
    const script =
      '#!/bin/sh\necho "  Hermes release version: 250829098.0.16"\n' +
      'echo "  HBC bytecode version: 98"\n';
    return writeTarGz([
      { path: 'hermes', mode: 0o755, data: Buffer.from(script) },
      { path: 'hermesc', mode: 0o755, data: Buffer.from(script) },
      { path: 'hvm', mode: 0o755, data: Buffer.from(script) },
    ]);
  }

  /** Serves `archive` with the digest the adapter should accept. */
  function serving(archive: Buffer, digest = sha256(archive)) {
    return async (url: string): Promise<AssetResponse> => {
      if (url.endsWith('.sha256')) {
        return { kind: 'ok', bytes: Buffer.from(`${digest}  ${ASSET}\n`) };
      }
      return { kind: 'ok', bytes: archive };
    };
  }

  it('downloads a published prebuilt and runs the tests on it', async () => {
    const homeDir = tempDir('argus-home-');
    const result = await provisionHermes(
      options({
        ...HOST,
        startDir: createProject(RN_V1_ONLY),
        homeDir,
        fetchAsset: serving(publishedArchive()),
      }),
    );

    expect(result.kind).toBe('provisioned');
    expect(result.kind === 'provisioned' && result.summary).toContain('prebuilt linux-x64');
    expect(result.kind === 'provisioned' && result.binary.path).toBe(
      join(homeDir, '.argus', 'cache', 'hermes-hermes-v250829098.0.16', 'build', 'bin', 'hermes'),
    );
    expect(result.kind === 'provisioned' && result.binary.bytecodeVersion).toBe(98);
  });

  it('falls through when nothing is published, rather than aborting', async () => {
    const result = await provisionHermes(
      options({ ...HOST, startDir: createProject(RN_V1_ONLY), allowSourceBuild: false }),
    );

    // Not a crash: the chain carried on and reported the whole picture.
    expect(result.kind).toBe('failed');
    const message = result.kind === 'failed' ? result.message : '';
    expect(message).toContain('prebuilt');
    expect(message).toContain('no published prebuilt');
    expect(message).toContain('--provision');
  });

  it('stops on a checksum mismatch instead of quietly building from source', async () => {
    const result = await provisionHermes(
      options({
        ...HOST,
        startDir: createProject(RN_V1_ONLY),
        allowSourceBuild: true,
        fetchAsset: serving(publishedArchive(), '0'.repeat(64)),
      }),
    );

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.message).toContain('failed its checksum');
  });
});

describe('provisionHermes — nothing available', () => {
  it('fails with an actionable message instead of building silently', async () => {
    const result = await provisionHermes(options({ startDir: createProject(RN_V1_ONLY) }));

    expect(result.kind).toBe('failed');
    const message = result.kind === 'failed' ? result.message : '';
    expect(message).toContain('hermes-v250829098.0.16');
    expect(message).toContain('cache');
    expect(message).toContain('--provision');
    expect(message).toContain('--hermes <path>');
  });

  it('reports that no React Native install was found', async () => {
    const result = await provisionHermes(options());

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.message).toContain('no React Native install found');
  });

  it('uses a binary vendored at ./.hermes/hermes with no flag at all', async () => {
    const startDir = createProject(RN_V1_ONLY);
    mkdirSync(join(startDir, '.hermes'), { recursive: true });
    const vendored = join(startDir, '.hermes', 'hermes');
    writeFileSync(vendored, '#!/bin/sh\necho "  HBC bytecode version: 98"\n');
    chmodSync(vendored, 0o755);

    const result = await provisionHermes(options({ startDir }));

    expect(result.kind).toBe('provisioned');
    expect(result.kind === 'provisioned' && result.binary.path).toBe(vendored);
    expect(result.kind === 'provisioned' && result.summary).toContain('project .hermes');
  });

  it('finds a cached build for the pinned tag', async () => {
    const homeDir = tempDir('argus-home-');
    const cached = join(
      homeDir,
      '.argus',
      'cache',
      'hermes-hermes-v250829098.0.16',
      'build',
      'bin',
      'hermes',
    );
    mkdirSync(join(cached, '..'), { recursive: true });
    writeFileSync(cached, '#!/bin/sh\necho "  HBC bytecode version: 98"\n');
    chmodSync(cached, 0o755);

    const result = await provisionHermes(options({ startDir: createProject(RN_V1_ONLY), homeDir }));

    expect(result.kind).toBe('provisioned');
    expect(result.kind === 'provisioned' && result.binary.path).toBe(cached);
    expect(result.kind === 'provisioned' && result.summary).toContain('cache');
  });
});

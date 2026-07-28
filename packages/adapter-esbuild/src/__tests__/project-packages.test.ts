import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type PackageDirResolver,
  projectPackageAliases,
  resolveProjectPackageDir,
} from '../project-packages.js';

const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const MODULE = join(HERE, 'project-packages.ts');
const RNTL = join(REPO_ROOT, 'packages', 'rntl');

describe('resolveProjectPackageDir', () => {
  it('resolves a package installed for the given project', () => {
    const dir = resolveProjectPackageDir('react', RNTL);

    expect(dir).toBeDefined();
    expect(dir?.endsWith('react')).toBe(true);
  });

  it('returns the package ROOT, not the directory of its entry point', () => {
    // test-renderer's entry point is dist/index.js. Only a package ROOT can be
    // aliased, so resolution must not land inside dist/.
    const dir = resolveProjectPackageDir('test-renderer', RNTL);

    expect(dir).toBeDefined();
    expect(dir?.endsWith('test-renderer')).toBe(true);
  });

  it('reports absence instead of throwing for a package that exists nowhere', () => {
    expect(resolveProjectPackageDir('argus-not-a-real-package', REPO_ROOT)).toBeUndefined();
  });
});

/**
 * Absence has to be proven in a CHILD PROCESS with NODE_PATH cleared.
 *
 * Node falls back to NODE_PATH when the ordinary upward walk finds nothing, and
 * pnpm sets NODE_PATH to its virtual store's hoist directory — which holds every
 * transitively installed package. So under `pnpm test` React resolves from an
 * empty temp directory, and an in-process assertion of absence would fail for a
 * reason that has nothing to do with this code.
 *
 * That fallback is correct behaviour and is deliberately left in place: it only
 * applies when the walk has already failed, and what it finds is still the
 * user's own store. It just makes absence untestable without isolating it, so
 * the child gets a clean NODE_PATH and answers the question honestly.
 */
describe('resolveProjectPackageDir under real Node', () => {
  function probe(fromDir: string): string {
    const script = [
      `import { resolveProjectPackageDir } from ${JSON.stringify(MODULE)};`,
      `const dir = resolveProjectPackageDir('react', ${JSON.stringify(fromDir)});`,
      'process.stdout.write(dir === undefined ? "undefined" : "resolved");',
    ].join('\n');

    return execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { encoding: 'utf8', cwd: REPO_ROOT, env: { ...process.env, NODE_PATH: '' } },
    ).trim();
  }

  it('finds no React for a project that has none', () => {
    const empty = mkdtempSync(join(tmpdir(), 'argus-no-react-'));
    try {
      expect(probe(empty)).toBe('undefined');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('finds React for a project that has it', () => {
    expect(probe(RNTL)).toBe('resolved');
  });
});

describe('projectPackageAliases', () => {
  const found: PackageDirResolver = (name) => join('/project', 'node_modules', name);
  const absent: PackageDirResolver = () => undefined;

  it('aliases React onto the copy the project under test installed', () => {
    expect(projectPackageAliases('/project', found)).toEqual({
      react: join('/project', 'node_modules', 'react'),
    });
  });

  it('yields no aliases at all for a project with no React', () => {
    // The pure-TypeScript case: nothing to alias, and nothing that needs
    // aliasing, because no test imports the component layer.
    expect(projectPackageAliases('/project', absent)).toEqual({});
  });

  it('claims only React, leaving every other specifier to ordinary resolution', () => {
    const asked: string[] = [];

    projectPackageAliases('/project', (name) => {
      asked.push(name);
      return undefined;
    });

    expect(asked).toEqual(['react']);
  });

  it('uses real resolution when no resolver is injected', () => {
    expect(projectPackageAliases(RNTL).react).toBe(resolveProjectPackageDir('react', RNTL));
  });
});

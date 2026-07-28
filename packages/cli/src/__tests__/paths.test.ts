import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frameworkPathsFrom, missingRuntimeRootMessage, selectRuntimeRoot } from '../paths.js';

/** Stands in for the filesystem: only the listed paths exist. */
function only(...present: string[]): (path: string) => boolean {
  return (path) => present.includes(path);
}

const MARKER = join('framework', 'src', 'index.ts');

describe('selectRuntimeRoot', () => {
  it('finds the runtime assets beside an installed binary', () => {
    // <pkg>/bin/argus.js  ->  <pkg>/runtime/
    const moduleDir = join('/pkg', 'bin');
    const root = join('/pkg', 'runtime');

    expect(selectRuntimeRoot(moduleDir, only(join(root, MARKER)))).toBe(root);
  });

  it('finds the runtime assets from the source layout under tsx', () => {
    // <repo>/packages/cli/src/paths.ts  ->  <repo>/packages/
    const moduleDir = join('/repo', 'packages', 'cli', 'src');
    const root = join('/repo', 'packages');

    expect(selectRuntimeRoot(moduleDir, only(join(root, MARKER)))).toBe(root);
  });

  it('prefers the installed layout when both could match', () => {
    const moduleDir = join('/pkg', 'bin');
    const installed = join('/pkg', 'runtime');
    const sibling = '/';

    const root = selectRuntimeRoot(moduleDir, only(join(installed, MARKER), join(sibling, MARKER)));

    expect(root).toBe(installed);
  });

  it('reports nothing rather than guessing when neither layout matches', () => {
    expect(selectRuntimeRoot(join('/somewhere', 'else'), only())).toBeUndefined();
  });

  it('requires the marker itself, not merely a directory of the right name', () => {
    // A consumer project can easily own a `runtime/` directory. Matching on the
    // directory name alone would point esbuild at their files.
    const moduleDir = join('/pkg', 'bin');
    const decoy = join('/pkg', 'runtime', 'framework', 'src', 'other.ts');

    expect(selectRuntimeRoot(moduleDir, only(decoy))).toBeUndefined();
  });
});

describe('frameworkPathsFrom', () => {
  it('derives every runtime asset path from one root', () => {
    const root = join('/pkg', 'runtime');

    expect(frameworkPathsFrom(root)).toEqual({
      frameworkPath: join(root, 'framework', 'src', 'index'),
      componentPath: join(root, 'rntl', 'src', 'index'),
      polyfillPaths: [join(root, 'framework', 'src', 'polyfill')],
    });
  });

  it('keeps rntl two levels below the root so its framework import resolves', () => {
    // rntl/src/index.ts imports '../../framework/src/lifecycle.js'. That path is
    // only correct while both packages sit directly under the same root.
    const root = join('/pkg', 'runtime');
    const { componentPath, frameworkPath } = frameworkPathsFrom(root);

    expect(join(componentPath, '..', '..', '..', 'framework', 'src', 'index')).toBe(frameworkPath);
  });
});

describe('missingRuntimeRootMessage', () => {
  it('names every location probed', () => {
    const message = missingRuntimeRootMessage(join('/pkg', 'bin'));

    expect(message).toContain(join('/pkg', 'runtime', MARKER));
    expect(message).toContain(join('/pkg', 'bin', '..', '..', MARKER));
    expect(message).toContain('reinstalling');
  });
});

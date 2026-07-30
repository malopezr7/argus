import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findTsconfig,
  parseJsonc,
  projectTsconfigRaw,
  readCompilerOptions,
  type TsconfigRaw,
} from '../project-tsconfig.js';

/**
 * These settings decide what the user's code MEANS, so the reader that finds
 * them has to be right about the file format real projects ship — JSONC with
 * comments and trailing commas — and about `extends`, which is where almost
 * every React Native project actually keeps them.
 *
 * It also has to be TOTAL. Argus reads this file on behalf of a user who was
 * only trying to run their tests; a stray comma must not become an
 * INFRASTRUCTURE FAILURE that takes down a whole test file. Every malformed
 * input below asserts a value, never a throw.
 */
const ROOT = mkdtempSync(join(tmpdir(), 'argus-tsconfig-'));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

let counter = 0;
/** An isolated project directory, so no case can see another's files. */
function project(files: Record<string, string>): string {
  const dir = join(ROOT, `p${counter++}`);
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('parsing the format tsconfigs are actually written in', () => {
  it('reads plain JSON', () => {
    expect(parseJsonc('{"a":1}')).toEqual({ a: 1 });
  });

  it('drops line and block comments', () => {
    const text = `{
      // a line comment
      "a": 1, /* and a block one */
      "b": 2
    }`;

    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  it('drops trailing commas in objects and arrays', () => {
    expect(parseJsonc('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it('keeps comment openers that are inside strings', () => {
    expect(parseJsonc('{"a":"http://x.example//y","b":"/* not a comment */"}')).toEqual({
      a: 'http://x.example//y',
      b: '/* not a comment */',
    });
  });

  it('keeps an escaped quote from ending the string early', () => {
    expect(parseJsonc('{"a":"say \\" // still inside"}')).toEqual({ a: 'say " // still inside' });
  });
});

describe('reading compilerOptions', () => {
  it('returns the options a lone tsconfig declares', () => {
    const dir = project({ 'tsconfig.json': '{"compilerOptions":{"experimentalDecorators":true}}' });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  it('inherits through a relative extends', () => {
    const dir = project({
      'base.json': '{"compilerOptions":{"experimentalDecorators":true,"target":"ES5"}}',
      'tsconfig.json': '{"extends":"./base.json","compilerOptions":{"target":"ES2022"}}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
      target: 'ES2022',
    });
  });

  it('accepts an extends written without the .json suffix', () => {
    const dir = project({
      'base.json': '{"compilerOptions":{"useDefineForClassFields":false}}',
      'tsconfig.json': '{"extends":"./base"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      useDefineForClassFields: false,
    });
  });

  it('resolves an extends that names a package', () => {
    const dir = project({
      'node_modules/@scope/preset/package.json': '{"name":"@scope/preset","version":"1.0.0"}',
      'node_modules/@scope/preset/tsconfig.json':
        '{ /* JSONC, like the real ones */ "compilerOptions":{"experimentalDecorators":true,} }',
      'tsconfig.json': '{"extends":"@scope/preset/tsconfig.json"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  it('applies an array of extends left to right, nearest last', () => {
    const dir = project({
      'a.json': '{"compilerOptions":{"target":"ES5","experimentalDecorators":true}}',
      'b.json': '{"compilerOptions":{"target":"ES2015"}}',
      'tsconfig.json': '{"extends":["./a.json","./b.json"]}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      target: 'ES2015',
      experimentalDecorators: true,
    });
  });

  /**
   * Cycle protection is per-path, not global.
   *
   * Two branches of one `extends` array routinely share an ancestor — a preset
   * both of them build on. A single visited-set threaded through the whole walk
   * marks that ancestor spent on the first branch, so the second inherits
   * nothing from it. The branches are then merged nearest-last, and whatever the
   * later branch should have re-inherited is silently replaced by the earlier
   * one's value.
   *
   * Verified against TypeScript 6.0.3 via getParsedCommandLineOfConfigFile:
   * `useDefineForClassFields` is true here, because `b` re-inherits it from
   * `base` and `b` is applied last.
   */
  it('lets both branches of an extends array inherit a shared ancestor', () => {
    const dir = project({
      'base.json': '{"compilerOptions":{"useDefineForClassFields":true}}',
      'a.json': '{"extends":"./base.json","compilerOptions":{"useDefineForClassFields":false}}',
      'b.json': '{"extends":"./base.json","compilerOptions":{"target":"ES2022"}}',
      'tsconfig.json': '{"extends":["./a.json","./b.json"]}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      useDefineForClassFields: true,
      target: 'ES2022',
    });
  });
});

/**
 * `extends` naming a package is how almost every React Native and Expo project
 * states the settings that decide emit — the local file usually declares none of
 * them. So a resolver that is merely close is a resolver that silently drops
 * every one of them and reinstates the original defect for exactly those
 * projects.
 *
 * Node's own `require.resolve` is not that resolver: it answers a different
 * question (which MODULE does this specifier load) and refuses or misdirects in
 * three shapes that real presets ship. Each case below was measured against
 * `esbuild.build()` first, and asserts the answer esbuild gives.
 */
describe('an extends that names a package', () => {
  const PRESET = '{"compilerOptions":{"experimentalDecorators":true}}';

  it('resolves the package-root form to its tsconfig.json', () => {
    const dir = project({
      'node_modules/@tsconfig/preset/package.json': '{"name":"@tsconfig/preset","version":"1.0.0"}',
      'node_modules/@tsconfig/preset/tsconfig.json': PRESET,
      'tsconfig.json': '{"extends":"@tsconfig/preset"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  /**
   * The package-root form must land on the tsconfig, never on the JS entry
   * point. Resolving it as a module returns `index.js`, which then fails to
   * parse as JSON and drops the whole preset without a word.
   */
  it('ignores the JS entry point when the package has one', () => {
    const dir = project({
      'node_modules/preset/package.json': '{"name":"preset","version":"1.0.0","main":"./index.js"}',
      'node_modules/preset/index.js': 'module.exports = {};',
      'node_modules/preset/tsconfig.json': PRESET,
      'tsconfig.json': '{"extends":"preset"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  /**
   * An `exports` map that does not list the tsconfig subpath is the common
   * shape, because the field was written to describe importable modules and a
   * tsconfig is not one. Node answers ERR_PACKAGE_PATH_NOT_EXPORTED; esbuild
   * falls back to the path on disk and reads it.
   */
  it('reads a subpath the exports map does not list', () => {
    const dir = project({
      'node_modules/preset/package.json':
        '{"name":"preset","version":"1.0.0","exports":{".":"./index.js"}}',
      'node_modules/preset/index.js': 'module.exports = {};',
      'node_modules/preset/tsconfig.json': PRESET,
      'tsconfig.json': '{"extends":"preset/tsconfig.json"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  it('follows an exports map that redirects the subpath elsewhere', () => {
    const dir = project({
      'node_modules/preset/package.json':
        '{"name":"preset","version":"1.0.0","exports":{"./tsconfig.json":"./real.json"}}',
      'node_modules/preset/tsconfig.json': '{"compilerOptions":{"target":"ES5"}}',
      'node_modules/preset/real.json': PRESET,
      'tsconfig.json': '{"extends":"preset/tsconfig.json"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  it('honours the tsconfig field a package declares for the root form', () => {
    const dir = project({
      'node_modules/preset/package.json':
        '{"name":"preset","version":"1.0.0","tsconfig":"./real.json"}',
      'node_modules/preset/tsconfig.json': '{"compilerOptions":{"target":"ES5"}}',
      'node_modules/preset/real.json': PRESET,
      'tsconfig.json': '{"extends":"preset"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  it('accepts an extensionless subpath, the shape expo/tsconfig.base uses', () => {
    const dir = project({
      'node_modules/expo/package.json': '{"name":"expo","version":"1.0.0"}',
      'node_modules/expo/tsconfig.base.json': PRESET,
      'tsconfig.json': '{"extends":"expo/tsconfig.base"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  /** Hoisted installs put the preset above the tsconfig that names it. */
  it('climbs node_modules directories to find a hoisted package', () => {
    const dir = project({
      'node_modules/@tsconfig/preset/package.json': '{"name":"@tsconfig/preset","version":"1.0.0"}',
      'node_modules/@tsconfig/preset/tsconfig.json': PRESET,
      'packages/app/tsconfig.json': '{"extends":"@tsconfig/preset"}',
    });

    expect(readCompilerOptions(join(dir, 'packages', 'app', 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
    });
  });

  it('yields no settings when the package is not installed at all', () => {
    const dir = project({
      'tsconfig.json': '{"extends":"@tsconfig/absent","compilerOptions":{"target":"ES2022"}}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({ target: 'ES2022' });
  });
});

/**
 * Every one of these is a real thing a user's repo can contain, and none of
 * them is Argus's to have an opinion about. The answer is always "no settings",
 * which builds exactly as Argus did before it read tsconfigs at all.
 */
describe('malformed input yields no settings rather than an exception', () => {
  it('survives a file that is not valid JSON at all', () => {
    const dir = project({ 'tsconfig.json': '{ this is not json' });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({});
  });

  it('survives a file that is not an object', () => {
    const dir = project({ 'tsconfig.json': '"just a string"' });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({});
  });

  it('survives a missing file', () => {
    expect(readCompilerOptions(join(ROOT, 'does', 'not', 'exist.json'))).toEqual({});
  });

  it('survives an extends that resolves to nothing', () => {
    const dir = project({
      'tsconfig.json': '{"extends":"./gone.json","compilerOptions":{"target":"ES2022"}}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({ target: 'ES2022' });
  });

  it('survives an extends cycle', () => {
    const dir = project({
      'a.json': '{"extends":"./b.json","compilerOptions":{"target":"ES5"}}',
      'b.json': '{"extends":"./a.json","compilerOptions":{"experimentalDecorators":true}}',
    });

    expect(readCompilerOptions(join(dir, 'a.json'))).toEqual({
      target: 'ES5',
      experimentalDecorators: true,
    });
  });
});

/**
 * Discovery has exactly one job: answer what `esbuild.build()` would answer.
 *
 * The V1 path IS `esbuild.build()`, which resolves tsconfig itself. So any rule
 * invented here that esbuild does not share is a new way for the two engines to
 * disagree — the very defect this module exists to close. Each case below was
 * measured against esbuild 0.28 before it was written down.
 */
describe('finding the tsconfig that governs a directory', () => {
  it('prefers the nearest one', () => {
    const dir = project({
      'tsconfig.json': '{"compilerOptions":{"target":"ES5"}}',
      'pkg/tsconfig.json': '{"compilerOptions":{"target":"ES2022"}}',
      'pkg/src/file.ts': '',
    });

    expect(findTsconfig(join(dir, 'pkg', 'src'))).toBe(join(dir, 'pkg', 'tsconfig.json'));
  });

  it('climbs to the project root when the leaf has none', () => {
    const dir = project({ 'tsconfig.json': '{}', 'src/deep/file.ts': '' });

    expect(findTsconfig(join(dir, 'src', 'deep'))).toBe(join(dir, 'tsconfig.json'));
  });

  /**
   * The CLI documents `root: 'packages/app'`, so the project root is routinely a
   * subdirectory of the repository that owns the tsconfig. esbuild keeps
   * climbing past it and finds the workspace-root config; a walk that stopped
   * at the project root left the legacy engine reading nothing at all while V1
   * read the workspace settings — the original defect, reopened for every
   * monorepo.
   */
  it('climbs past the project root, because esbuild does', () => {
    const dir = project({ 'tsconfig.json': '{}', 'packages/app/src/file.ts': '' });

    expect(findTsconfig(join(dir, 'packages', 'app', 'src'))).toBe(join(dir, 'tsconfig.json'));
  });

  it('reports nothing for a project that declares no tsconfig', () => {
    const dir = project({ 'src/file.ts': '' });

    expect(findTsconfig(join(dir, 'src'))).toBeUndefined();
  });
});

/**
 * esbuild deliberately gives files under `node_modules` NO tsconfig — not the
 * consumer's, and not one the dependency ships itself. A dependency is compiled
 * as its author published it, whatever the consumer happens to have configured.
 *
 * Reading the consumer's config there is not a smaller mistake than reading
 * none: it hands a dependency a decorator protocol and class-field semantics
 * its author never chose, on the legacy engine only. Argus's own installed
 * runtime lives under `node_modules/@arguslab/argus/runtime`, so the settings of
 * whatever project it happens to be installed into would otherwise govern the
 * shipped framework and rntl sources.
 */
describe('a file under node_modules', () => {
  it('is governed by no tsconfig at all', () => {
    const dir = project({
      'tsconfig.json': '{"compilerOptions":{"useDefineForClassFields":false}}',
      'node_modules/dep/index.ts': '',
    });

    expect(findTsconfig(join(dir, 'node_modules', 'dep'))).toBeUndefined();
  });

  it('does not pick up a tsconfig the dependency ships itself', () => {
    const dir = project({
      'node_modules/dep/tsconfig.json': '{"compilerOptions":{"useDefineForClassFields":false}}',
      'node_modules/dep/src/index.ts': '',
    });

    expect(findTsconfig(join(dir, 'node_modules', 'dep', 'src'))).toBeUndefined();
  });

  it('is excluded however deep the node_modules segment sits in its path', () => {
    const dir = project({
      'tsconfig.json': '{}',
      'node_modules/dep/a/b/c/index.ts': '',
    });

    expect(findTsconfig(join(dir, 'node_modules', 'dep', 'a', 'b', 'c'))).toBeUndefined();
  });

  it('still governs an ordinary project file that merely sits alongside one', () => {
    const dir = project({
      'tsconfig.json': '{}',
      'node_modules/dep/index.ts': '',
      'src/file.ts': '',
    });

    expect(findTsconfig(join(dir, 'src'))).toBe(join(dir, 'tsconfig.json'));
  });
});

describe('the cached lookup handed to the bundler', () => {
  it('is undefined for a project with no tsconfig', () => {
    const dir = project({ 'src/file.ts': '' });

    expect(projectTsconfigRaw(join(dir, 'src'), new Map())).toBeUndefined();
  });

  it('wraps the options in the shape esbuild takes', () => {
    const dir = project({
      'tsconfig.json': '{"compilerOptions":{"experimentalDecorators":true}}',
      'src/file.ts': '',
    });

    expect(projectTsconfigRaw(join(dir, 'src'), new Map())).toEqual({
      compilerOptions: { experimentalDecorators: true },
    });
  });

  it('answers a repeated directory from the cache rather than the disk', () => {
    const dir = project({ 'tsconfig.json': '{"compilerOptions":{"target":"ES2022"}}' });
    const cache = new Map<string, TsconfigRaw | undefined>();

    const first = projectTsconfigRaw(dir, cache);
    rmSync(join(dir, 'tsconfig.json'));

    expect(projectTsconfigRaw(dir, cache)).toBe(first);
  });

  it('caches the absence too, so a missing tsconfig is not re-walked', () => {
    const dir = project({ 'src/file.ts': '' });
    const cache = new Map<string, TsconfigRaw | undefined>();

    projectTsconfigRaw(join(dir, 'src'), cache);

    expect(cache.has(join(dir, 'src'))).toBe(true);
    expect(cache.get(join(dir, 'src'))).toBeUndefined();
  });
});

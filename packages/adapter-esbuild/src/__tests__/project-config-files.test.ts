import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HermesEngine } from '@arguslab/core';
import { afterAll, describe, expect, it } from 'vitest';
import { EsbuildBundler } from '../index.js';
import { findTsconfig, parseJsonc, readCompilerOptions } from '../project-tsconfig.js';

/**
 * WHICH file the settings are read from, and whether it parses at all.
 *
 * Both are upstream of everything the sibling fidelity suite asserts: a reader
 * that is right about `extends` and precedence is still wrong about the project
 * if it opened the wrong file, or opened the right one and threw away every
 * setting over three leading bytes.
 *
 * The V1 path IS `esbuild.build()`, so the rule to match is esbuild's own and
 * nothing else. Every case below states an answer measured from
 * `esbuild.build()` on esbuild 0.28.1 first — raw observations, `target:
 * ['es2020']` so both signals are lowered and visible, entry at `pkg/entry.ts`:
 *
 *   no config at all                              es-proposal/define
 *   tsconfig(opts) at root                        ts-legacy/assign
 *   jsconfig(opts) at root                        ts-legacy/assign
 *   root tsconfig(opts) + nearer pkg/jsconfig({}) es-proposal/define
 *   root tsconfig({}) + nearer pkg/jsconfig(opts) ts-legacy/assign
 *   same dir: tsconfig(opts) + jsconfig({})       ts-legacy/assign
 *   same dir: tsconfig({}) + jsconfig(opts)       es-proposal/define
 *   root jsconfig(opts) + nearer pkg/tsconfig({}) es-proposal/define
 *   root jsconfig({}) + nearer pkg/tsconfig(opts) ts-legacy/assign
 *   tsconfig(opts) WITH a leading U+FEFF          ts-legacy/assign
 *   extends a base.json WITH a leading U+FEFF     ts-legacy/assign
 *
 * Read together those say three things. esbuild honours `jsconfig.json`. It
 * climbs to the NEAREST directory holding either name and stops there — a
 * nearer config that declares nothing blanks an ancestor that declares
 * everything, rather than falling through to it. And within one directory
 * `tsconfig.json` beats `jsconfig.json`. A BOM is simply skipped.
 */
const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const COMPONENT_PATH = resolve(REPO_ROOT, 'packages', 'rntl', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');

/**
 * `realpathSync` is load-bearing, not tidiness: macOS reaches the temp
 * directory through a symlink and esbuild reports resolved paths, so a project
 * anchored at the unresolved spelling describes a different tree than the one
 * esbuild walks — and every assertion then passes for the wrong reason.
 */
const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'argus-config-files-')));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

let counter = 0;
function scratchProject(files: Record<string, string>): string {
  const dir = join(SCRATCH, `p${counter++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

const BOM = '\uFEFF';

/** The two settings that change EMIT rather than types, so a bundle shows them. */
const OPTIONS =
  '{"compilerOptions":{"experimentalDecorators":true,"useDefineForClassFields":false}}';

/** A decorator written for the TypeScript legacy protocol, plus a class field. */
const DECORATED_SOURCE = `function log(_t: unknown, _k: string, d: PropertyDescriptor) {
  return d;
}

export class Svc {
  marker = 1;

  @log
  run(): number {
    return this.marker;
  }
}

console.log(new Svc().run());
`;

async function bundleIn(projectDir: string, name: string, engine: HermesEngine): Promise<string> {
  const { code } = await new EsbuildBundler().bundle({
    testPaths: [resolve(projectDir, name)],
    frameworkPath: FRAMEWORK_PATH,
    componentPath: COMPONENT_PATH,
    polyfillPaths: [POLYFILL_PATH],
    engine,
    projectDir,
  });
  return code;
}

/** Which decorator protocol the bundle was built against. */
function decoratorProtocol(code: string): string {
  if (code.includes('__decorateClass')) return 'typescript-legacy';
  if (code.includes('__decorateElement')) return 'es-proposal';
  return 'none';
}

/** Whether the field is installed by assignment or left to define semantics. */
function markerSemantics(code: string): string {
  return /this\.marker = 1/.test(code) ? 'assign' : 'define';
}

describe('jsconfig.json is a config file too', () => {
  it('is preferred over an ancestor tsconfig.json, because it is nearer', () => {
    const dir = scratchProject({
      'tsconfig.json': OPTIONS,
      'pkg/jsconfig.json': '{}',
      'pkg/entry.ts': '',
    });

    expect(findTsconfig(join(dir, 'pkg'))).toBe(join(dir, 'pkg', 'jsconfig.json'));
  });

  /**
   * The half of "nearest wins" that is easy to get accidentally right. A nearer
   * config declaring NOTHING must still stop the climb: esbuild answered
   * es-proposal/define for that layout, which is the no-settings baseline, not
   * the ancestor's ts-legacy/assign.
   */
  it('stops the climb even when it declares nothing at all', () => {
    const dir = scratchProject({
      'tsconfig.json': OPTIONS,
      'pkg/jsconfig.json': '{}',
      'pkg/entry.ts': '',
    });

    const found = findTsconfig(join(dir, 'pkg'));

    expect(found).not.toBeUndefined();
    expect(readCompilerOptions(found as string)).toEqual({});
  });

  it('is read when it is the only config the project has', () => {
    const dir = scratchProject({ 'jsconfig.json': OPTIONS, 'pkg/entry.ts': '' });

    expect(findTsconfig(join(dir, 'pkg'))).toBe(join(dir, 'jsconfig.json'));
  });

  it('yields to tsconfig.json when both sit in the same directory', () => {
    const dir = scratchProject({
      'pkg/tsconfig.json': OPTIONS,
      'pkg/jsconfig.json': '{}',
      'pkg/entry.ts': '',
    });

    expect(findTsconfig(join(dir, 'pkg'))).toBe(join(dir, 'pkg', 'tsconfig.json'));
  });

  it('yields to tsconfig.json in the same directory even when it holds the settings', () => {
    const dir = scratchProject({
      'pkg/tsconfig.json': '{}',
      'pkg/jsconfig.json': OPTIONS,
      'pkg/entry.ts': '',
    });

    expect(findTsconfig(join(dir, 'pkg'))).toBe(join(dir, 'pkg', 'tsconfig.json'));
  });

  it('loses to a nearer tsconfig.json in a lower directory', () => {
    const dir = scratchProject({
      'jsconfig.json': OPTIONS,
      'pkg/tsconfig.json': '{}',
      'pkg/entry.ts': '',
    });

    expect(findTsconfig(join(dir, 'pkg'))).toBe(join(dir, 'pkg', 'tsconfig.json'));
  });

  it('is still excluded under node_modules, like every other config', () => {
    const dir = scratchProject({
      'node_modules/dep/jsconfig.json': OPTIONS,
      'node_modules/dep/index.ts': '',
    });

    expect(findTsconfig(join(dir, 'node_modules', 'dep'))).toBeUndefined();
  });
});

/**
 * A UTF-8 BOM is what Visual Studio and plenty of Windows editors write by
 * default, and `JSON.parse` rejects it outright. Caught by the totality guard,
 * that failure is silent: every setting is discarded and the file reads as
 * though the project had configured nothing — while esbuild, and so the V1
 * path, reads it perfectly normally.
 */
describe('a leading byte-order mark', () => {
  it('does not stop the file being parsed', () => {
    expect(parseJsonc(`${BOM}{"a":1}`)).toEqual({ a: 1 });
  });

  it('does not discard the compilerOptions of the file that carries it', () => {
    const dir = scratchProject({ 'tsconfig.json': BOM + OPTIONS });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
      useDefineForClassFields: false,
    });
  });

  /**
   * The preset a project extends is a separate file with its own encoding, and
   * it is where React Native projects keep the settings that decide emit — so a
   * BOM there drops more than a BOM on the local file does.
   */
  it('does not discard settings inherited through extends', () => {
    const dir = scratchProject({
      'base.json': BOM + OPTIONS,
      'tsconfig.json': '{"extends":"./base.json"}',
    });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({
      experimentalDecorators: true,
      useDefineForClassFields: false,
    });
  });

  it('leaves the reader total when what follows it is not JSON', () => {
    const dir = scratchProject({ 'tsconfig.json': `${BOM}{ this is not json` });

    expect(readCompilerOptions(join(dir, 'tsconfig.json'))).toEqual({});
  });
});

/**
 * The property under repair, stated the only way that establishes it: same
 * source, same layout on disk, only the engine varied. A unit assertion on
 * discovery proves the function answers what esbuild answers; only this proves
 * the two engines still mean the same thing by the user's code.
 *
 * Each case carries an absolute assertion as well, so a future regression in
 * which BOTH engines drift the same wrong way cannot pass as agreement.
 */
describe('the config file read cannot depend on the engine', () => {
  it('agrees when a nearer jsconfig blanks an ancestor tsconfig', async () => {
    const dir = scratchProject({
      'tsconfig.json': OPTIONS,
      'pkg/jsconfig.json': '{}',
      'pkg/entry.ts': DECORATED_SOURCE,
    });

    const [legacy, v1] = await Promise.all([
      bundleIn(dir, join('pkg', 'entry.ts'), 'legacy'),
      bundleIn(dir, join('pkg', 'entry.ts'), 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
    // esbuild measured es-proposal/define here: the nearer empty jsconfig wins.
    expect(decoratorProtocol(legacy)).toBe('es-proposal');
    expect(markerSemantics(legacy)).toBe('define');
  });

  it('agrees on a project whose only config is a jsconfig', async () => {
    const dir = scratchProject({ 'jsconfig.json': OPTIONS, 'pkg/entry.ts': DECORATED_SOURCE });

    const [legacy, v1] = await Promise.all([
      bundleIn(dir, join('pkg', 'entry.ts'), 'legacy'),
      bundleIn(dir, join('pkg', 'entry.ts'), 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
    expect(decoratorProtocol(legacy)).toBe('typescript-legacy');
    expect(markerSemantics(legacy)).toBe('assign');
  });

  it('agrees when the tsconfig carries a byte-order mark', async () => {
    const dir = scratchProject({ 'tsconfig.json': BOM + OPTIONS, 'entry.ts': DECORATED_SOURCE });

    const [legacy, v1] = await Promise.all([
      bundleIn(dir, 'entry.ts', 'legacy'),
      bundleIn(dir, 'entry.ts', 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
    expect(decoratorProtocol(legacy)).toBe('typescript-legacy');
    expect(markerSemantics(legacy)).toBe('assign');
  });

  it('agrees when the preset reached through extends carries one', async () => {
    const dir = scratchProject({
      'base.json': BOM + OPTIONS,
      'tsconfig.json': '{"extends":"./base.json"}',
      'entry.ts': DECORATED_SOURCE,
    });

    const [legacy, v1] = await Promise.all([
      bundleIn(dir, 'entry.ts', 'legacy'),
      bundleIn(dir, 'entry.ts', 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
    expect(decoratorProtocol(legacy)).toBe('typescript-legacy');
    expect(markerSemantics(legacy)).toBe('assign');
  });
});

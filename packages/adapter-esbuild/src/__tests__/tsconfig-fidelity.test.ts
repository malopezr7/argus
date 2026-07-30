import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HermesEngine } from '@arguslab/core';
import { afterAll, describe, expect, it } from 'vitest';
import { EsbuildBundler } from '../index.js';
import { findTsconfig } from '../project-tsconfig.js';

/**
 * The engine decides which SYNTAX is emitted. It must never decide what the
 * code MEANS.
 *
 * Lowering exists precisely so the two engines can be handed different syntax —
 * that is the whole point. But the legacy path reaches the user's own
 * TypeScript through a separate esbuild entry point from the V1 path, and the
 * two do not read the same configuration unless they are made to: `transform()`
 * ignores tsconfig entirely, while `build()` reads it. Left alone, that split
 * silently changed the meaning of ordinary TypeScript depending on which VM the
 * project happened to ship.
 *
 * Two settings prove it, because both change EMIT rather than types:
 *
 *   experimentalDecorators   picks the TypeScript legacy decorator protocol
 *                            (target, key, descriptor) over the incompatible
 *                            ES-decorators proposal protocol.
 *   useDefineForClassFields  picks assign semantics (`this.v = 1`, which runs
 *                            an inherited setter) over define semantics
 *                            (Object.defineProperty, which skips it).
 *
 * So every assertion below is differential: same source, same tsconfig, both
 * engines, and the answer has to match. The absolute assertions on top of that
 * stop a future regression in which BOTH engines drift the same wrong way.
 */
const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const FRAMEWORK_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'index');
const COMPONENT_PATH = resolve(REPO_ROOT, 'packages', 'rntl', 'src', 'index');
const POLYFILL_PATH = resolve(REPO_ROOT, 'packages', 'framework', 'src', 'polyfill');
const FIXTURES = resolve(REPO_ROOT, 'packages', 'adapter-esbuild', 'src', '__tests__', 'fixtures');

/** A fixture project that carries its own tsconfig, like a real user project. */
const TSCONFIG_PROJECT = resolve(FIXTURES, 'tsconfig-project');

/** The same, but reaching its settings through an `extends` chain. */
const EXTENDS_PROJECT = resolve(FIXTURES, 'tsconfig-extends');

const ENGINES: readonly HermesEngine[] = ['legacy', 'v1'];

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

async function bundleInProject(name: string, engine: HermesEngine): Promise<string> {
  return bundleIn(TSCONFIG_PROJECT, name, engine);
}

/**
 * Which decorator protocol the bundle was built against.
 *
 * esbuild names the two helpers differently, and they are not
 * interchangeable — a decorator written for one receives arguments of the
 * wrong shape from the other.
 */
function decoratorProtocol(code: string): string {
  if (code.includes('__decorateClass')) return 'typescript-legacy';
  if (code.includes('__decorateElement')) return 'es-proposal';
  return 'none';
}

/** Whether a class field is installed by assignment or by defineProperty. */
function classFieldSemantics(code: string): string {
  return code.includes('__publicField') ? 'define' : 'assign';
}

describe("the project's tsconfig survives class lowering", () => {
  it.each(ENGINES)('uses the decorator protocol the tsconfig asks for on %s', async (engine) => {
    const code = await bundleInProject('decorator-entry.ts', engine);

    expect(decoratorProtocol(code)).toBe('typescript-legacy');
  });

  it.each(ENGINES)('uses the class-field semantics the tsconfig asks for on %s', async (engine) => {
    const code = await bundleInProject('class-fields-entry.ts', engine);

    expect(classFieldSemantics(code)).toBe('assign');
  });
});

/**
 * The differential form of the same question, stated as the property that
 * actually matters: whatever the answer is, it cannot depend on the engine.
 */
describe('the engine changes the syntax, never the semantics', () => {
  it('agrees on the decorator protocol across both engines', async () => {
    const [legacy, v1] = await Promise.all([
      bundleInProject('decorator-entry.ts', 'legacy'),
      bundleInProject('decorator-entry.ts', 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
  });

  it('agrees on the class-field semantics across both engines', async () => {
    const [legacy, v1] = await Promise.all([
      bundleInProject('class-fields-entry.ts', 'legacy'),
      bundleInProject('class-fields-entry.ts', 'v1'),
    ]);

    expect(classFieldSemantics(legacy)).toBe(classFieldSemantics(v1));
  });
});

/**
 * JSX is the third thing the two paths disagreed about, and the one least
 * likely to be noticed: a `.tsx` file that took the lowering detour was given
 * the build's automatic runtime while the very same file on V1 was given the
 * factory its tsconfig named. Two different function calls for one element.
 *
 * Which of the two esbuild settles on is its own precedence rule and not
 * something this suite asserts — the fixture project names a factory purely so
 * the two paths have something to disagree ABOUT. What must hold is that they
 * do not.
 */
describe('JSX is transformed the same way on both engines', () => {
  function jsxTransform(code: string): string {
    if (code.includes('NotTheBuildsFactory')) return 'tsconfig-factory';
    if (code.includes('jsxDEV')) return 'automatic-runtime';
    return 'none';
  }

  it('agrees on the JSX transform for a lowered .tsx file', async () => {
    const [legacy, v1] = await Promise.all([
      bundleInProject('jsx-entry.tsx', 'legacy'),
      bundleInProject('jsx-entry.tsx', 'v1'),
    ]);

    expect(jsxTransform(legacy)).toBe(jsxTransform(v1));
  });

  it('still transforms the JSX away, whichever transform that is', async () => {
    const code = await bundleInProject('jsx-entry.tsx', 'legacy');

    expect(jsxTransform(code)).not.toBe('none');
    expect(code).not.toContain('<Text>');
  });
});

/**
 * Almost no React Native project states these settings itself — it extends
 * `@tsconfig/react-native` or `expo/tsconfig.base` and inherits them. So a
 * reader that stops at the first file would be right about the shape of a
 * tsconfig and wrong about every real project, which is the same defect again
 * with a longer fuse.
 *
 * The fixture preset is reached by a bare, extensionless package specifier and
 * is written in JSONC with a trailing comma, because that is what those
 * packages actually ship.
 */
describe('settings inherited through extends', () => {
  it.each(ENGINES)('are honoured on %s', async (engine) => {
    const code = await bundleIn(EXTENDS_PROJECT, 'decorator-entry.ts', engine);

    expect(decoratorProtocol(code)).toBe('typescript-legacy');
  });

  it('leave the two engines agreeing', async () => {
    const [legacy, v1] = await Promise.all([
      bundleIn(EXTENDS_PROJECT, 'decorator-entry.ts', 'legacy'),
      bundleIn(EXTENDS_PROJECT, 'decorator-entry.ts', 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
  });
});

/**
 * The cases above run from fixtures committed inside this repository, which is
 * fine for asserting that a tsconfig IS honoured but useless for asserting that
 * an absent one changes nothing: everything under `packages/` sits below
 * `packages/adapter-esbuild/tsconfig.json`, so discovery there always finds
 * something. The layouts below are therefore built on a real filesystem,
 * outside the repository, so "no tsconfig" and "a tsconfig above the project
 * root" mean what they say.
 *
 * `realpathSync` matters: on macOS the temp directory is reached through a
 * symlink, esbuild reports resolved paths, and a project anchored at the
 * unresolved spelling would silently describe a different tree than the one
 * esbuild walks.
 */
const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'argus-fidelity-')));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

let scratchCounter = 0;
function scratchProject(files: Record<string, string>): string {
  const dir = join(SCRATCH, `p${scratchCounter++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

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

/** Whether the field is installed by assignment or left to define semantics. */
function markerSemantics(code: string): string {
  return /this\.marker = 1/.test(code) ? 'assign' : 'define';
}

/**
 * esbuild gives a dependency under `node_modules` NO tsconfig — not the
 * consumer's, and not one the dependency ships. The V1 path IS `esbuild.build()`
 * and so does exactly that; a legacy path that instead walked up into the
 * consumer's config compiled the SAME dependency under a different decorator
 * protocol and different field semantics depending only on the engine.
 *
 * Argus's own runtime is installed at `node_modules/@arguslab/argus/runtime`,
 * and the published tarball ships no tsconfig of its own, so the setting that
 * governed the shipped framework sources would have been whatever the user
 * happened to configure.
 */
describe('a dependency under node_modules', () => {
  function dependencyProject(): string {
    return scratchProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
      }),
      'node_modules/argus-fixture-dep/package.json': JSON.stringify({
        name: 'argus-fixture-dep',
        version: '1.0.0',
        main: 'index.ts',
      }),
      'node_modules/argus-fixture-dep/index.ts': DECORATED_SOURCE,
      'entry.ts': "import 'argus-fixture-dep';\n",
    });
  }

  it('is compiled the same way on both engines', async () => {
    const dir = dependencyProject();

    const [legacy, v1] = await Promise.all([
      bundleIn(dir, 'entry.ts', 'legacy'),
      bundleIn(dir, 'entry.ts', 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
  });

  it("is not compiled under the consumer's compilerOptions", async () => {
    const dir = dependencyProject();

    const legacy = await bundleIn(dir, 'entry.ts', 'legacy');

    expect(decoratorProtocol(legacy)).toBe('es-proposal');
    expect(markerSemantics(legacy)).toBe('define');
  });
});

/**
 * The CLI documents `root: 'packages/app'`, so the directory Argus is anchored
 * at is routinely a package inside a larger repository whose tsconfig lives at
 * the workspace root. esbuild climbs to it; a walk that stopped at the project
 * root read nothing at all, which is the original defect for every monorepo
 * that keeps its settings where monorepos keep them.
 */
describe('a project root below the tsconfig that governs it', () => {
  function monorepo(): string {
    return scratchProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
      }),
      'packages/app/src/entry.ts': DECORATED_SOURCE,
    });
  }

  it('reads the workspace-root settings on both engines', async () => {
    const root = monorepo();
    const app = join(root, 'packages', 'app');

    const [legacy, v1] = await Promise.all([
      bundleIn(app, join('src', 'entry.ts'), 'legacy'),
      bundleIn(app, join('src', 'entry.ts'), 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(decoratorProtocol(legacy)).toBe('typescript-legacy');
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
    expect(markerSemantics(legacy)).toBe('assign');
  });
});

/**
 * The three package shapes Node's module resolver answers differently from
 * TypeScript's — each one measured against `esbuild.build()` before being
 * written down, and each one a way for a project to lose every inherited
 * setting without a diagnostic.
 */
describe('settings inherited from a package that is not a module', () => {
  const PRESET = JSON.stringify({
    compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
  });

  const SHAPES: ReadonlyArray<readonly [string, Record<string, string>]> = [
    [
      'a package root with no JS entry point',
      {
        'node_modules/@tsconfig/argus-shape/package.json': JSON.stringify({
          name: '@tsconfig/argus-shape',
          version: '1.0.0',
        }),
        'node_modules/@tsconfig/argus-shape/tsconfig.json': PRESET,
        'tsconfig.json': JSON.stringify({ extends: '@tsconfig/argus-shape' }),
      },
    ],
    [
      'a package root that also ships a JS entry point',
      {
        'node_modules/argus-shape/package.json': JSON.stringify({
          name: 'argus-shape',
          version: '1.0.0',
          main: './index.js',
        }),
        'node_modules/argus-shape/index.js': 'module.exports = {};',
        'node_modules/argus-shape/tsconfig.json': PRESET,
        'tsconfig.json': JSON.stringify({ extends: 'argus-shape' }),
      },
    ],
    [
      'a subpath the package exports map does not list',
      {
        'node_modules/argus-shape/package.json': JSON.stringify({
          name: 'argus-shape',
          version: '1.0.0',
          exports: { '.': './index.js' },
        }),
        'node_modules/argus-shape/index.js': 'module.exports = {};',
        'node_modules/argus-shape/tsconfig.json': PRESET,
        'tsconfig.json': JSON.stringify({ extends: 'argus-shape/tsconfig.json' }),
      },
    ],
  ];

  it.each(SHAPES)('are honoured for %s', async (_shape, files) => {
    const dir = scratchProject({ ...files, 'entry.ts': DECORATED_SOURCE });

    const [legacy, v1] = await Promise.all([
      bundleIn(dir, 'entry.ts', 'legacy'),
      bundleIn(dir, 'entry.ts', 'v1'),
    ]);

    expect(decoratorProtocol(legacy)).toBe(decoratorProtocol(v1));
    expect(decoratorProtocol(legacy)).toBe('typescript-legacy');
    expect(markerSemantics(legacy)).toBe(markerSemantics(v1));
    expect(markerSemantics(legacy)).toBe('assign');
  });
});

/**
 * Argus's own repository declares no root tsconfig, and neither will plenty of
 * the projects it runs in. Discovery finding nothing must mean "carry on",
 * never a throw and never a different bundle.
 *
 * The earlier version of this case asserted that from a fixture inside
 * `packages/`, where `packages/adapter-esbuild/tsconfig.json` sits two
 * directories above — so it was handed a fully populated config and proved the
 * opposite of what it claimed. The absence is therefore established here rather
 * than assumed: the walk is run and required to come back empty before anything
 * is concluded from the bundle.
 */
describe('a project with no tsconfig at all', () => {
  const NO_TSCONFIG_SOURCE = `export class Punto {
  constructor(public x: number) {}

  dob(): number {
    return this.x * 2;
  }
}

console.log(new Punto(2).dob());
`;

  it('genuinely has none anywhere above it', () => {
    const dir = scratchProject({ 'entry.ts': NO_TSCONFIG_SOURCE });

    // Stated as the walk itself, so the premise cannot quietly stop holding.
    const climbed: string[] = [];
    for (let d = dir; ; d = dirname(d)) {
      climbed.push(join(d, 'tsconfig.json'));
      if (dirname(d) === d) break;
    }

    expect(climbed.filter(existsSync)).toEqual([]);
    expect(findTsconfig(dir)).toBeUndefined();
  });

  it('still lowers user classes on legacy', async () => {
    const dir = scratchProject({ 'entry.ts': NO_TSCONFIG_SOURCE });

    const code = await bundleIn(dir, 'entry.ts', 'legacy');

    expect(code).toContain('dob');
    expect(code).not.toMatch(/\bclass(?:\s+[$\w]+)?(?:\s+extends\s+[$\w.]+)?\s*\{/m);
  });

  /**
   * The property the ledger actually asks for: with nothing to find, the
   * lowering pass must hand esbuild exactly the arguments it handed before any
   * of this existed. Two bundles of the same sources differ only in the private
   * result nonce, so that is the one thing normalised away.
   */
  it('bundles identically every time, with no configuration reaching it', async () => {
    const dir = scratchProject({ 'entry.ts': NO_TSCONFIG_SOURCE });

    const [first, second] = await Promise.all([
      bundleIn(dir, 'entry.ts', 'legacy'),
      bundleIn(dir, 'entry.ts', 'legacy'),
    ]);

    const withoutNonce = (code: string): string => code.replace(/\b[0-9a-f]{24}\b/g, '<nonce>');

    expect(withoutNonce(first)).toBe(withoutNonce(second));
    expect(findTsconfig(dir)).toBeUndefined();
  });
});

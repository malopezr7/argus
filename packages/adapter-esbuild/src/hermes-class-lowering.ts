import { readFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { type FileResult, type PluginObject, transformAsync } from '@babel/core';
import transformClasses from '@babel/plugin-transform-classes';
import { type Loader, type Plugin, transform } from 'esbuild';
import { projectTsconfigRaw, type TsconfigRaw } from './project-tsconfig.js';

/**
 * Class lowering for the legacy Hermes engine, which cannot parse `class` in
 * ANY form — not a declaration, not an expression, not `new class {}`.
 *
 * esbuild cannot do this itself: asking it to lower classes fails with
 * "Transforming class syntax to the configured target environment is not
 * supported yet". Babel can, so classes take a detour through it.
 *
 * The scope is EVERY file in the bundle, not just dependencies. A class in the
 * user's own test file is ordinary React Native code and the legacy VM rejects
 * it exactly as hard as one from `node_modules` — restricting this pass to
 * `node_modules` is what let `class Punto {}` in a `.test.ts` reach the engine
 * verbatim and kill the whole file before any test ran.
 *
 * Reaching the user's own source means reaching TypeScript and JSX, which
 * Babel cannot parse with only `transform-classes` loaded. Rather than add a
 * second TypeScript implementation with its own opinions, the file is stripped
 * by esbuild first and Babel only ever sees plain JavaScript.
 */

/** Every extension that can hold a class and end up in the bundle. */
const LOWERABLE = /\.(?:cjs|js|jsx|mjs|cts|mts|ts|tsx)$/;

/**
 * Fail-safe candidate gate, not a JavaScript parser.
 *
 * `onLoad` receives raw contents before esbuild parses them, so no AST signal is
 * available here without doing the strip transform for every file. Every valid
 * class has a `class` token followed eventually by `{`; comments and strings can
 * create false positives, but those only pay the transform cost. A false
 * negative would send unsupported syntax to legacy Hermes and lose the file.
 */
const CLASS_SYNTAX = /\bclass\b[\s\S]*\{/;

/** esbuild loader for a path, by extension. Unknown extensions are plain JS. */
const LOADERS: Readonly<Record<string, Loader>> = {
  '.cjs': 'js',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cts': 'ts',
  '.mts': 'ts',
  '.ts': 'ts',
  '.tsx': 'tsx',
};

type BabelSourceType = 'commonjs' | 'module' | 'unambiguous';

/** Preserve explicit module kinds; infer ambiguous JavaScript and TypeScript. */
function babelSourceType(path: string): BabelSourceType {
  switch (extname(path)) {
    case '.cjs':
    case '.cts':
      return 'commonjs';
    case '.mjs':
    case '.mts':
      return 'module';
    default:
      return 'unambiguous';
  }
}

export function hasClassSyntax(source: string): boolean {
  return CLASS_SYNTAX.test(source);
}

/**
 * Ask esbuild's parser whether `source` contains an actual class AST node.
 *
 * Stage 1 already parsed this exact JavaScript successfully. Repeating that
 * parse with only class support disabled therefore has two outcomes: success
 * proves the broad text gate matched a comment/string, while failure is treated
 * conservatively as a real class so Babel's original error remains loud.
 */
async function esbuildConfirmsClassSyntax(
  source: string,
  sourcefile: string,
  options: ClassLoweringOptions,
): Promise<boolean> {
  try {
    await transform(source, {
      loader: 'js',
      target: options.target,
      supported: { ...options.supported, class: false },
      sourcefile,
    });
    return false;
  } catch {
    return true;
  }
}

/**
 * The JSX settings the bundle is built with.
 *
 * They are passed in rather than re-declared so the pre-Babel strip cannot
 * drift from the main build: a file that took the lowering detour must come out
 * of it having had exactly the same JSX transform as one that did not.
 */
export interface ClassLoweringOptions {
  /** esbuild target for the strip pass — the engine's, so nothing is over-lowered. */
  target: string[];
  /** Per-feature overrides applied with `target`. */
  supported: Record<string, boolean>;
  /** JSX options mirrored from the build. */
  jsx: { jsx: 'automatic'; jsxImportSource: string; jsxDev: boolean };
}

export function hermesClassLowering(options: ClassLoweringOptions): Plugin {
  /** One filesystem walk and one config read per directory, not per file. */
  const tsconfigByDir = new Map<string, TsconfigRaw | undefined>();

  return {
    name: 'hermes-class-lowering',
    setup(build): void {
      build.onLoad({ filter: LOWERABLE }, async function lowerClass(args) {
        const source = await readFile(args.path, 'utf8');
        // Cheap reject first: most files in a bundle have no class at all, and
        // skipping them leaves esbuild to load them exactly as it always would.
        if (!hasClassSyntax(source)) return undefined;

        const loader = LOADERS[extname(args.path)] ?? 'js';
        const sourceDir = dirname(args.path);
        const tsconfigRaw = projectTsconfigRaw(sourceDir, tsconfigByDir);

        // Stage 1 — esbuild strips TypeScript and transforms JSX, so Babel only
        // ever sees plain JavaScript. `sourcemap: 'inline'` is what lets stage 2
        // compose onto it instead of starting a new map from generated code.
        const stripped = await transform(source, {
          loader,
          target: options.target,
          supported: options.supported,
          sourcefile: args.path,
          sourcemap: 'inline',
          // The project's TypeScript settings, which `transform()` will not go
          // looking for on its own. Without this the legacy path emitted a
          // different decorator protocol and different class-field semantics
          // from the V1 path, for the same source and the same tsconfig.
          ...(tsconfigRaw === undefined ? {} : { tsconfigRaw }),
          // Spread in the same order the main build receives them — tsconfig
          // first, the build's JSX settings after — so esbuild resolves the two
          // against each other exactly once. Whichever it settles on, a file
          // that took the lowering detour comes out transformed like one that
          // did not, which is the only property that matters here.
          ...options.jsx,
        });

        // Stage 2 — Babel lowers the classes and folds stage 1's inline map into
        // its own, so a stack frame still points at the user's original line.
        let foundClass = false;
        const markClassSyntax = (): PluginObject => ({
          visitor: {
            ClassDeclaration(): void {
              foundClass = true;
            },
            ClassExpression(): void {
              foundClass = true;
            },
          },
        });
        const sourceType = babelSourceType(args.path);
        let lowered: FileResult | null;
        try {
          lowered = await transformAsync(stripped.code, {
            babelrc: false,
            compact: false,
            configFile: false,
            filename: args.path,
            // `.cjs`/`.cts` are CommonJS, `.mjs`/`.mts` are modules, and the
            // remaining loaders can represent either. Babel's default module
            // mode is wrong for CommonJS wrapper syntax such as top-level return.
            sourceType,
            ...(sourceType === 'unambiguous'
              ? { parserOpts: { allowReturnOutsideFunction: true } }
              : {}),
            plugins: [markClassSyntax, transformClasses],
            sourceFileName: args.path,
            sourceMaps: 'inline',
          });
        } catch (error) {
          // Babel does not parse every program esbuild accepts. A broad-gate
          // false positive must fall back to the normal loader; a genuine class
          // still fails here rather than reaching legacy Hermes unlowered.
          if (!(await esbuildConfirmsClassSyntax(stripped.code, args.path, options))) {
            return undefined;
          }
          throw error;
        }
        // A fail-safe candidate can be a comment or string. Babel's parsed AST
        // decides whether production output changes; false positives pay CPU
        // only and fall back to esbuild's normal loader and source map.
        if (!foundClass) return undefined;
        if (lowered?.code === undefined || lowered.code === null) {
          throw new Error(`Babel produced no output for ${args.path}`);
        }

        return {
          contents: lowered.code,
          loader: 'js',
          resolveDir: dirname(args.path),
        };
      });
    },
  };
}

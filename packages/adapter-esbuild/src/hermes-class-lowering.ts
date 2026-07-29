import { readFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { transformAsync } from '@babel/core';
import transformClasses from '@babel/plugin-transform-classes';
import { type Loader, type Plugin, transform } from 'esbuild';

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

const CLASS_SYNTAX = /\bclass\b[^;{]*\{/m;

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

export function hasClassSyntax(source: string): boolean {
  return CLASS_SYNTAX.test(source);
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
  return {
    name: 'hermes-class-lowering',
    setup(build): void {
      build.onLoad({ filter: LOWERABLE }, async function lowerClass(args) {
        const source = await readFile(args.path, 'utf8');
        // Cheap reject first: most files in a bundle have no class at all, and
        // skipping them leaves esbuild to load them exactly as it always would.
        if (!hasClassSyntax(source)) return undefined;

        const loader = LOADERS[extname(args.path)] ?? 'js';

        // Stage 1 — esbuild strips TypeScript and transforms JSX, so Babel only
        // ever sees plain JavaScript. `sourcemap: 'inline'` is what lets stage 2
        // compose onto it instead of starting a new map from generated code.
        const stripped = await transform(source, {
          loader,
          target: options.target,
          supported: options.supported,
          sourcefile: args.path,
          sourcemap: 'inline',
          ...options.jsx,
        });

        // Stage 2 — Babel lowers the classes and folds stage 1's inline map into
        // its own, so a stack frame still points at the user's original line.
        const lowered = await transformAsync(stripped.code, {
          babelrc: false,
          compact: false,
          configFile: false,
          filename: args.path,
          plugins: [transformClasses],
          sourceFileName: args.path,
          sourceMaps: 'inline',
        });
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

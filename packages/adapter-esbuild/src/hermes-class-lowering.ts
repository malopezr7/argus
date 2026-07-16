import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { transformAsync } from '@babel/core';
import transformClasses from '@babel/plugin-transform-classes';
import type { Plugin } from 'esbuild';

const DEPENDENCY_JAVASCRIPT = /\.(?:cjs|js|mjs)$/;
const NODE_MODULES_PATH = /[/\\]node_modules[/\\]/;
const CLASS_SYNTAX = /\bclass\b[^;{]*\{/m;

export function hasClassSyntax(source: string): boolean {
  return CLASS_SYNTAX.test(source);
}

export function hermesClassLowering(): Plugin {
  return {
    name: 'hermes-class-lowering',
    setup(build): void {
      build.onLoad({ filter: DEPENDENCY_JAVASCRIPT }, async function lowerDependencyClass(args) {
        if (!NODE_MODULES_PATH.test(args.path)) return undefined;

        const source = await readFile(args.path, 'utf8');
        if (!hasClassSyntax(source)) return undefined;

        const result = await transformAsync(source, {
          babelrc: false,
          compact: false,
          configFile: false,
          filename: args.path,
          plugins: [transformClasses],
          sourceFileName: args.path,
          sourceMaps: 'inline',
        });
        if (result?.code === undefined || result.code === null) {
          throw new Error(`Babel produced no output for ${args.path}`);
        }

        return {
          contents: result.code,
          loader: 'js',
          resolveDir: dirname(args.path),
        };
      });
    },
  };
}

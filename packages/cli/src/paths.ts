import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FrameworkPaths {
  /** Absolute path to packages/framework/src/index (without extension). */
  frameworkPath: string;
  /** Absolute paths to polyfill modules (without extension). */
  polyfillPaths: string[];
}

/**
 * Resolves the framework and polyfill source paths relative to this CLI package.
 *
 * Layout:
 *   packages/cli/src/paths.ts   <- import.meta.url here
 *   packages/cli/src/           <- dirname (0)
 *   packages/cli/               <- dirname + ../ (1)
 *   packages/                   <- dirname + ../../ (2)
 *   {repoRoot}/                 <- dirname + ../../../ (3)
 *   packages/framework/src/index.ts  <- target
 *
 * Using source paths (no build step) — tsx resolves them directly.
 */
export function resolveFrameworkPaths(): FrameworkPaths {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/src
  const repoRoot = join(here, '..', '..', '..'); // up 3: src -> cli -> packages -> root

  const frameworkSrc = join(repoRoot, 'packages', 'framework', 'src');

  return {
    frameworkPath: join(frameworkSrc, 'index'),
    polyfillPaths: [join(frameworkSrc, 'polyfill')],
  };
}

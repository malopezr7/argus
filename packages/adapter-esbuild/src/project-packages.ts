import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Packages that belong to the PROJECT UNDER TEST, not to Argus.
 *
 * React is the user's. Their components import it, their app pins its version,
 * and the renderer has to share the exact module instance those components were
 * built against — two copies of React in one bundle means two copies of the
 * internals that `act` and the reconciler coordinate through, and component
 * tests break in ways that look like Argus bugs.
 *
 * So React is resolved from the user's project and aliased, which pins every
 * `react` and `react/jsx-dev-runtime` import in the bundle — theirs, ours, and
 * the renderer's — onto one directory.
 */
export const PROJECT_OWNED_PACKAGES: readonly string[] = ['react'];

/**
 * `createRequire` needs a FILE to resolve from, not a directory, and it never
 * reads this one — the name only has to be unambiguous in a stack trace.
 */
const RESOLUTION_ANCHOR = 'argus-package-resolution.js';

/**
 * Absolute directory of `specifier` as installed in `fromDir`, or undefined.
 *
 * Resolving `<specifier>/package.json` rather than the package entry point is
 * deliberate: an entry point can sit anywhere inside the package (`dist/index.js`
 * is typical), so its directory is not the package root and cannot be aliased.
 * The manifest is always at the root. Modern packages with an `exports` map
 * publish `./package.json` for exactly this reason, and packages old enough not
 * to have `exports` expose every path anyway.
 *
 * TOTAL — a package that is absent, unresolvable, or hides its manifest is a
 * normal outcome, not an error. Absence is what a project with no React looks
 * like, and that project must still be able to run a pure-TypeScript suite.
 */
export function resolveProjectPackageDir(specifier: string, fromDir: string): string | undefined {
  try {
    const requireFrom = createRequire(join(fromDir, RESOLUTION_ANCHOR));
    return dirname(requireFrom.resolve(`${specifier}/package.json`));
  } catch {
    return undefined;
  }
}

/** How a package name becomes a directory. Injected so callers can test it. */
export type PackageDirResolver = (specifier: string, fromDir: string) => string | undefined;

/**
 * esbuild aliases for the project-owned packages that `fromDir` actually has.
 *
 * A package the project does not have is simply left out. esbuild resolves
 * aliases LAZILY — an alias for a module nothing imports is never consulted, and
 * a missing alias falls back to ordinary resolution from the importing file.
 * Both halves matter:
 *
 *   - A pure-TypeScript suite never imports `argus`, so the component layer that
 *     imports React is never pulled into the graph, so React is never needed.
 *     No React installed anywhere is a working configuration.
 *   - In the Argus monorepo, and in any consumer whose package manager hoists,
 *     ordinary resolution finds React from the importing file. Omitting the
 *     alias degrades to that instead of failing.
 */
export function projectPackageAliases(
  fromDir: string,
  resolve: PackageDirResolver = resolveProjectPackageDir,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of PROJECT_OWNED_PACKAGES) {
    const dir = resolve(name, fromDir);
    if (dir !== undefined) aliases[name] = dir;
  }
  return aliases;
}

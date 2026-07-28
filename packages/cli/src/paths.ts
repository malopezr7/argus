import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FrameworkPaths {
  /** Absolute path to the framework entry (without extension). */
  frameworkPath: string;
  /** Absolute path to the component-testing entry (without extension). */
  componentPath: string;
  /** Absolute paths to polyfill modules (without extension). */
  polyfillPaths: string[];
}

/**
 * The framework and the component-testing layer are RUNTIME ASSETS, not host
 * code: they are never imported by Node. Their paths are handed to esbuild,
 * which compiles them from TypeScript on the user's machine every run. So they
 * must be located on disk, and the shape of the disk differs between the two
 * layouts Argus runs in:
 *
 *   development (tsx, from source)      installed (npm)
 *   ────────────────────────────────    ───────────────────────
 *   packages/cli/src/paths.ts           <pkg>/bin/argus.js
 *   packages/framework/src/index.ts     <pkg>/runtime/framework/src/index.ts
 *   packages/rntl/src/index.ts          <pkg>/runtime/rntl/src/index.ts
 *
 * Both reduce to the same question — "which directory holds `framework/src` and
 * `rntl/src`?" — so there is ONE rule with two candidate answers, probed on
 * disk rather than inferred from a build flag. Nothing has to tell Argus which
 * layout it is in; it looks.
 *
 * Resolution is anchored to this module's own location, never to the working
 * directory. Anchoring to the CWD is what made the previous version fail once
 * installed: it looked for `packages/framework/src` under whatever project the
 * user happened to be testing, found nothing, and pointed esbuild at a path
 * that did not exist instead of failing.
 *
 * The published layout mirrors `packages/<name>/src` exactly, and that is load
 * bearing: `rntl/src/index.ts` imports `../../framework/src/lifecycle.js`, a
 * relative path across the package boundary. Flattening the copy would break
 * that import, so the two-level shape is preserved verbatim in the tarball.
 */
const RUNTIME_ROOT_CANDIDATES: readonly (readonly string[])[] = [
  // Installed: this module is bundled into <pkg>/bin/argus.js.
  ['..', 'runtime'],
  // Development: this module is packages/cli/src/paths.ts, run through tsx.
  ['..', '..'],
];

/** Proves a candidate is a runtime root rather than a coincidental directory. */
const RUNTIME_ROOT_MARKER: readonly string[] = ['framework', 'src', 'index.ts'];

/**
 * Pick the runtime root holding the framework and component-testing sources.
 *
 * Pure apart from the injected probe, so both layouts are testable without
 * building a package or staging a fake install.
 */
export function selectRuntimeRoot(
  moduleDir: string,
  exists: (path: string) => boolean,
): string | undefined {
  for (const segments of RUNTIME_ROOT_CANDIDATES) {
    const root = join(moduleDir, ...segments);
    if (exists(join(root, ...RUNTIME_ROOT_MARKER))) return root;
  }
  return undefined;
}

/** The paths esbuild needs, given a resolved runtime root. */
export function frameworkPathsFrom(runtimeRoot: string): FrameworkPaths {
  const frameworkSrc = join(runtimeRoot, 'framework', 'src');
  return {
    frameworkPath: join(frameworkSrc, 'index'),
    componentPath: join(runtimeRoot, 'rntl', 'src', 'index'),
    polyfillPaths: [join(frameworkSrc, 'polyfill')],
  };
}

/**
 * Message for the one unrecoverable case: the runtime assets are not beside the
 * binary. That means a broken install (or a `dist/` built before the assets
 * were staged), so it names the directories actually probed instead of leaving
 * the user to guess.
 */
export function missingRuntimeRootMessage(moduleDir: string): string {
  const probed = RUNTIME_ROOT_CANDIDATES.map((segments) =>
    join(moduleDir, ...segments, ...RUNTIME_ROOT_MARKER),
  );
  return [
    'Argus could not find its runtime assets (the framework and component-testing sources).',
    'This means the installation is incomplete — try reinstalling Argus.',
    'Looked for:',
    ...probed.map((path) => `  ${path}`),
  ].join('\n');
}

/** Resolve the runtime asset paths for whichever layout this build runs in. */
export function resolveFrameworkPaths(): FrameworkPaths {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = selectRuntimeRoot(moduleDir, existsSync);
  if (runtimeRoot === undefined) throw new Error(missingRuntimeRootMessage(moduleDir));
  return frameworkPathsFrom(runtimeRoot);
}

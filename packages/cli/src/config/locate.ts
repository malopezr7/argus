import { basename, dirname, join } from 'node:path';

/**
 * Finding the config file.
 *
 * Split from loading it so the search rule — which is all policy and no I/O —
 * can be tested without staging directory trees on disk. The only outside
 * contact is the injected `exists` probe.
 */

/** The conventional directory that holds configuration rather than source. */
const CONFIG_DIRECTORY = '.config';

/**
 * Config file names, in the order they are tried within a directory.
 *
 * TypeScript first because that is the one worth writing: Node type-strips it
 * natively, so it costs nothing and gets checked. `.js` and `.mjs` follow as
 * the escape hatch for the two constructs stripping cannot handle.
 *
 * There is no `.cjs`, `.json`, `.yaml` or `.toml`. Argus is ESM-only, and each
 * additional format is a parser to carry and a way for two configs to disagree.
 */
export const CONFIG_FILE_NAMES: readonly string[] = [
  'argus.config.ts',
  'argus.config.mts',
  'argus.config.js',
  'argus.config.mjs',
  join(CONFIG_DIRECTORY, 'argus.config.ts'),
];

/**
 * Which directory a config file GOVERNS.
 *
 * Normally the directory holding it, so a relative `root` and the default
 * discovery root are both relative to the config itself rather than to
 * wherever `argus` was invoked.
 *
 * `.config/` is the exception, because it is a container for configuration and
 * not a project: `<project>/.config/argus.config.ts` configures `<project>`.
 * Without this step the discovery root lands inside `.config/`, which holds no
 * tests, and the run dies with "no test files matched" — a message that points
 * at the globs when the root is what is wrong.
 *
 * Applied to `--config` as well, so the same file behaves identically whether
 * it was discovered or named.
 */
export function configBaseDir(configPath: string): string {
  const dir = dirname(configPath);
  return basename(dir) === CONFIG_DIRECTORY ? dirname(dir) : dir;
}

/** Where the configuration is going to come from. */
export type ConfigLocation =
  /** A config module to import. */
  | { kind: 'file'; path: string }
  /**
   * A package.json that MAY carry an `argus` field. Whether it actually does
   * cannot be known without reading it, which is the loader's job.
   */
  | { kind: 'package-json'; path: string }
  /** Nothing was found; the built-in defaults apply. */
  | { kind: 'defaults' };

/**
 * Search upward from `startDir` for the configuration.
 *
 * Two rules decide everything:
 *
 *   FIRST HIT WINS, never a merge. Within a directory the names above are tried
 *   in order and the first that exists is the config. Two config files side by
 *   side is a mistake; merging them would make "which settings are in effect?"
 *   unanswerable without reading both and knowing the precedence.
 *
 *   package.json IS THE CEILING. The walk stops at the first directory holding
 *   one, whether or not it carries an `argus` field. Without that stop, a stray
 *   `argus.config.ts` in a home directory or a sibling checkout would quietly
 *   govern this project's test run — a config nobody in the project can see.
 */
export function locateConfig(startDir: string, exists: (path: string) => boolean): ConfigLocation {
  let dir = startDir;

  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const path = join(dir, name);
      if (exists(path)) return { kind: 'file', path };
    }

    const packageJson = join(dir, 'package.json');
    if (exists(packageJson)) return { kind: 'package-json', path: packageJson };

    const parent = dirname(dir);
    if (parent === dir) return { kind: 'defaults' };
    dir = parent;
  }
}

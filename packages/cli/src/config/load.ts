import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ArgusConfig } from '@arguslab/core';
import { errMsg } from '../errors.js';
import { importConfigSource, isEsmSyntaxError } from './esm-fallback.js';
import { configBaseDir, locateConfig } from './locate.js';
import { ConfigError, validateConfig } from './validate.js';

/**
 * Loading the configuration.
 *
 * A TypeScript config is imported directly, with NO transpiler: Node strips the
 * types itself (`process.features.typescript`), so `await import(...)` on an
 * `argus.config.ts` just works. That is the whole reason this layer carries no
 * dependency — no c12, no cosmiconfig, no jiti, and no routing through the
 * Hermes bundler, which would couple the composition root to a Hermes-specific
 * tool in order to read its own config.
 *
 * Stripping is not compiling, and it buys that simplicity at one cost: `enum`
 * and `namespace` cannot be erased without emitting code, so Node refuses them.
 * `describeLoadFailure` turns that refusal into an explanation.
 *
 * The other thing a bare `import()` gets wrong is a project whose package.json
 * says `"type": "commonjs"` — what `npm init -y` writes — where Node reads the
 * config as a script and rejects the first `import` in it. `esm-fallback.ts`
 * reloads it as the ES module it is; this layer only names the file when even
 * that could not be done.
 */

/** Where the configuration came from, and what it said. */
export interface LoadedConfig {
  /** The validated config. `{}` when nothing was found. */
  config: ArgusConfig;
  /** The file it was read from. Absent when the defaults are in force. */
  source?: string;
  /**
   * Directory that relative paths in the config resolve against — the config
   * file's own directory, or the start directory when there is no config.
   */
  baseDir: string;
}

export interface LoadConfigOptions {
  /** Where the upward search begins, normally the working directory. */
  startDir: string;
  /** `--config <path>`. Skips the search; a missing file is an error. */
  explicitPath?: string;
}

/**
 * Turn a failed config import into something the user can act on.
 *
 * The strip-only case is singled out because Node's own message — "TypeScript
 * enum is not supported in strip-only mode" — is accurate and useless: nothing
 * in it says who is doing the stripping, why, or what to do instead. It is
 * matched on the error CODE rather than the wording, which is not a stable API.
 *
 * Every other failure is passed through verbatim. A config file that throws has
 * already produced the most informative message available, and replacing it
 * with a generic one would be a downgrade.
 */
export function describeLoadFailure(path: string, error: unknown): string {
  const code = (error as { code?: unknown }).code;

  if (code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    return [
      `Failed to load the Argus config at ${path}:`,
      `  ${errMsg(error)}`,
      '',
      '  Argus loads a TypeScript config with Node\u2019s native type stripping, which',
      '  erases types without compiling. `enum` and `namespace` emit real code, so',
      '  they cannot be stripped and are the two constructs a config cannot use.',
      '  Use a plain object, a union of string literals, or `as const` instead \u2014',
      '  or move the config to argus.config.js, which is not stripped at all.',
    ].join('\n');
  }

  if (isEsmSyntaxError(error)) {
    return [
      `Failed to load the Argus config at ${path}:`,
      `  ${errMsg(error)}`,
      '',
      '  The nearest package.json says "type": "commonjs" \u2014 what `npm init -y`',
      '  writes \u2014 so Node reads this file as a CommonJS script, where `import`',
      '  and `export` are syntax errors. Argus normally reloads such a config as',
      '  an ES module by itself, and could not this time. Any one of these makes',
      '  the file unambiguous:',
      '',
      '    \u2022 rename it to argus.config.mts   (TypeScript, always an ES module)',
      '    \u2022 add "type": "module" to package.json',
      '    \u2022 rename it to argus.config.mjs   (JavaScript, always an ES module)',
    ].join('\n');
  }

  return `Failed to load the Argus config at ${path}:\n  ${errMsg(error)}`;
}

/** Import a config module and take its default export. */
async function importConfigModule(path: string): Promise<unknown> {
  let module: { default?: unknown };
  try {
    module = await importConfigSource(path);
  } catch (error) {
    throw new ConfigError(describeLoadFailure(path, error));
  }

  if (module.default === undefined) {
    throw new ConfigError(
      `The Argus config at ${path} has no default export.\n` +
        '  Export the config as the default:\n' +
        "    import { defineConfig } from '@arguslab/argus';\n" +
        '    export default defineConfig({ /* ... */ });',
    );
  }

  return module.default;
}

/**
 * Read the `argus` field out of a package.json.
 *
 * Parsed, never executed — a package.json is data, and the whole point of
 * supporting it is that it carries no code. Returns `undefined` when the file
 * has no such field, which is the ordinary case and not an error.
 */
function readPackageJsonField(path: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Failed to read ${path}:\n  ${errMsg(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;
  return (parsed as Record<string, unknown>).argus;
}

/**
 * Find, load and validate the configuration.
 *
 * @throws {ConfigError} for a missing `--config` target, a config that fails to
 * import, one with no default export, or one whose values are invalid. Every
 * one of those is exit code 2 — none of them falls back to the defaults, because
 * running with settings the user did not ask for is the failure this whole
 * layer exists to prevent.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  if (options.explicitPath !== undefined) {
    const path = isAbsolute(options.explicitPath)
      ? options.explicitPath
      : resolve(options.startDir, options.explicitPath);

    if (!existsSync(path)) {
      throw new ConfigError(`The config file passed to --config does not exist:\n  ${path}`);
    }

    return {
      config: validateConfig(await importConfigModule(path), path),
      source: path,
      baseDir: configBaseDir(path),
    };
  }

  const location = locateConfig(options.startDir, existsSync);

  if (location.kind === 'file') {
    return {
      config: validateConfig(await importConfigModule(location.path), location.path),
      source: location.path,
      baseDir: configBaseDir(location.path),
    };
  }

  if (location.kind === 'package-json') {
    const field = readPackageJsonField(location.path);
    // No field means no config was found at all, so relative paths keep
    // resolving against the working directory. Silently moving the discovery
    // root up to the nearest package.json would make `argus` run the whole
    // monorepo from inside one package, which nobody asked for.
    if (field === undefined) return { config: {}, baseDir: options.startDir };

    return {
      config: validateConfig(field, location.path),
      source: location.path,
      baseDir: dirname(location.path),
    };
  }

  return { config: {}, baseDir: options.startDir };
}

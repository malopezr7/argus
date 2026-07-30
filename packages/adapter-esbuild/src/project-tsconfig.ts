import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * The TypeScript settings of the project under test, read for the one esbuild
 * entry point that will not go and find them itself.
 *
 * `build()` reads a tsconfig; `transform()` does not. The main bundle goes
 * through build(), so on V1 — where classes are left alone and nothing else
 * runs — the project's settings applied. The legacy engine cannot parse `class`
 * at all, so its files detour through a `transform()` strip pass on the way to
 * Babel, and that pass saw no tsconfig whatsoever.
 *
 * The result was the same source and the same tsconfig meaning two different
 * things depending on which VM the project happened to ship. Two settings show
 * it plainly, because both change EMIT rather than types:
 *
 *   experimentalDecorators   the TypeScript legacy decorator protocol
 *                            (target, key, descriptor) instead of the
 *                            incompatible ES-decorators proposal protocol.
 *                            A decorator written for one is called with
 *                            arguments of the wrong shape by the other.
 *   useDefineForClassFields  assign semantics (`this.v = 1`, which runs an
 *                            inherited setter) instead of define semantics
 *                            (Object.defineProperty, which skips it).
 *
 * Lowering exists so the two engines can be handed different SYNTAX — that is
 * the whole point of it. This module is what stops it also handing them
 * different meanings.
 *
 * Everything here is TOTAL. A missing file, a malformed one, a broken `extends`
 * or a cycle all resolve to "no settings", never a throw: an exception would
 * surface as an INFRASTRUCTURE FAILURE and take down a whole test file, which
 * is a far worse answer to a stray comma than building the way Argus did before
 * it read tsconfigs at all.
 */

/** What esbuild accepts as an inline tsconfig on `transform()`. */
export interface TsconfigRaw {
  compilerOptions: Record<string, unknown>;
}

/**
 * A tsconfig is JSONC, not JSON: comments and trailing commas are normal in one
 * and `JSON.parse` rejects both. The `@tsconfig/*` presets a React Native
 * project extends are written that way as a matter of course.
 *
 * A comment opener inside a string literal is not a comment, so this tracks
 * whether it is inside a string rather than reaching for a regex.
 *
 * A leading UTF-8 BOM is dropped first. It is what Visual Studio and several
 * Windows editors write by default, `JSON.parse` rejects it outright, and the
 * totality guard above turns that rejection into silence: every setting
 * discarded and the project read as though it had configured nothing, while
 * esbuild — and so the V1 path — skips the mark and reads the file normally.
 * It is dropped HERE rather than at the call site so a preset reached through
 * `extends` is covered by the same rule; that file has its own encoding, and
 * it is where React Native projects keep the settings that decide emit.
 */
export function parseJsonc(text: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      // An escaped quote does not end the string, and the escaped character is
      // copied with it so it cannot be re-examined as an opener of its own.
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }

  // Trailing commas last, once no comment or string literal can be mistaken
  // for one.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** The first of `candidates` that is a file on disk. */
function firstExisting(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** `@scope/name/sub/path` → name `@scope/name`, subpath `sub/path`. */
function splitPackageSpecifier(specifier: string): { name: string; subpath?: string } {
  const parts = specifier.split('/');
  const nameParts = specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1);
  const rest = parts.slice(nameParts.length);
  return {
    name: nameParts.join('/'),
    subpath: rest.length === 0 ? undefined : rest.join('/'),
  };
}

/**
 * The installed directory of `name`, found by climbing `node_modules`
 * directories the way every resolver does — so a preset hoisted to the
 * workspace root is still found from a tsconfig nested inside a package.
 */
function findPackageDir(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** A package.json as an object, or undefined if it is missing or malformed. */
function readPackageJson(pkgDir: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/**
 * The tsconfig a package offers under its bare name, with no subpath.
 *
 * This is deliberately NOT module resolution. Asking Node for `"preset"` yields
 * the package's JS entry point, which then fails to parse as JSON and takes
 * every inherited setting down with it in silence. What is wanted is the
 * `tsconfig` field if the package declares one, and `tsconfig.json` otherwise.
 */
function packageRootTsconfig(pkgDir: string): string | undefined {
  const declared = readPackageJson(pkgDir)?.tsconfig;
  if (typeof declared === 'string') {
    const target = resolve(pkgDir, declared);
    const found = firstExisting([target, `${target}.json`]);
    if (found !== undefined) return found;
  }
  return firstExisting([join(pkgDir, 'tsconfig.json')]);
}

/**
 * A subpath resolved through the package's `exports` map, when it has one.
 *
 * The map may point somewhere else entirely, and Node's resolver is the thing
 * that reads it. It is consulted ONLY when the field is present: for an
 * ordinary package it would answer the wrong question, preferring a sibling
 * `.js` over the `.json` that `extends` actually means.
 */
function resolveThroughExports(
  specifier: string,
  fromFile: string,
  pkgDir: string,
): string | undefined {
  if (readPackageJson(pkgDir)?.exports === undefined) return undefined;
  try {
    return createRequire(fromFile).resolve(specifier);
  } catch {
    // A map that does not list the subpath is the common shape — the field
    // describes importable modules and a tsconfig is not one. esbuild falls
    // back to the path on disk, and so does the caller.
    return undefined;
  }
}

/**
 * Resolve one `extends` entry to a file on disk.
 *
 * TypeScript accepts a relative path or a bare package specifier — the latter
 * is how projects pick up `@tsconfig/react-native` or `expo/tsconfig.base` —
 * and lets the `.json` suffix be left off either way.
 *
 * The bare form is where almost every React Native project keeps the settings
 * that decide emit, so getting it wrong does not degrade gracefully: it drops
 * every inherited option at once, without a diagnostic, for exactly the
 * projects Argus exists to serve. Node's `require.resolve` answers a different
 * question — which MODULE does this specifier load — and diverges from
 * TypeScript in three shapes real presets ship: a package root with no JS entry
 * point, a package root that has one, and a subpath its `exports` map does not
 * list. Each branch below was measured against `esbuild.build()`.
 */
function resolveExtends(specifier: string, fromFile: string): string | undefined {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const direct = resolve(dirname(fromFile), specifier);
    return firstExisting([direct, `${direct}.json`]);
  }

  const { name, subpath } = splitPackageSpecifier(specifier);
  const pkgDir = findPackageDir(name, dirname(fromFile));
  if (pkgDir === undefined) return undefined;

  if (subpath === undefined) return packageRootTsconfig(pkgDir);

  const exported = resolveThroughExports(specifier, fromFile, pkgDir);
  if (exported !== undefined) return exported;

  const target = join(pkgDir, subpath);
  return firstExisting([target, `${target}.json`]);
}

/** `extends` is a string, or — since TypeScript 5 — an array of them. */
function extendsList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  return [];
}

/**
 * The compilerOptions of `file` with its `extends` chain folded in.
 *
 * Nearer wins: each parent is layered in declaration order and the file's own
 * options are applied over all of them.
 *
 * `seen` is the chain currently being followed, NOT every file visited — it
 * breaks cycles, which are a property of one path, and nothing else. Branches
 * of an `extends` array routinely share an ancestor, since a preset both of
 * them build on is the ordinary reason to list two. A single set threaded
 * through the whole walk marks that ancestor spent on the first branch, so the
 * second inherits nothing from it, and the merge — which is nearest-last —
 * then keeps the earlier branch's value where the later one should have won.
 */
export function readCompilerOptions(
  file: string,
  seen: Set<string> = new Set(),
): Record<string, unknown> {
  if (seen.has(file)) return {};
  seen.add(file);

  let parsed: unknown;
  try {
    parsed = parseJsonc(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const node = parsed as { extends?: unknown; compilerOptions?: unknown };

  let options: Record<string, unknown> = {};
  for (const parent of extendsList(node.extends)) {
    const parentFile = resolveExtends(parent, file);
    if (parentFile === undefined) continue;
    // A copy per branch: each one descends with its own chain, so a shared
    // ancestor is read once for every branch that names it.
    options = { ...options, ...readCompilerOptions(parentFile, new Set(seen)) };
  }

  const own = node.compilerOptions;
  return typeof own === 'object' && own !== null
    ? { ...options, ...(own as Record<string, unknown>) }
    : options;
}

/**
 * Whether a path lies inside an installed package.
 *
 * esbuild gives such files NO tsconfig — not the consumer's, and not one the
 * dependency ships itself. A dependency is compiled as its author published it,
 * whatever the project it was installed into happens to configure.
 *
 * Honouring the consumer's config there is not a milder mistake than honouring
 * none: it hands somebody else's code a decorator protocol and class-field
 * semantics its author never chose, on the legacy engine alone. Argus's own
 * runtime is one of those dependencies — it is installed at
 * `node_modules/@arguslab/argus/runtime` and the published tarball ships no
 * tsconfig of its own — so without this the compilerOptions of whichever
 * project it landed in would have governed the shipped framework sources.
 */
function insideNodeModules(dir: string): boolean {
  return dir.split(/[\\/]/).includes('node_modules');
}

/**
 * The config file names esbuild looks for, in the order it prefers them within
 * one directory.
 *
 * `jsconfig.json` is not a JavaScript-only affair to esbuild: measured on 0.28,
 * a project whose only config is a `jsconfig.json` has it applied to a `.ts`
 * entry point like any other. Omitting it left such a project reading nothing
 * at all on the legacy path while V1 read it in full.
 */
const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'] as const;

/**
 * The nearest config file at or above `fromDir`, exactly as esbuild would find
 * it.
 *
 * Nearest-first, and with NO ceiling. An earlier version stopped at the project
 * root, on the reasoning that a walk should not climb out of the project — but
 * `build()` has no such rule, and the CLI's own `root` option is documented
 * pointing at a subdirectory (`root: 'packages/app'`). For every monorepo that
 * keeps its tsconfig at the workspace root, that ceiling meant V1 read the
 * settings and legacy read nothing: the same divergence this module exists to
 * close, reintroduced by the attempt to close it.
 *
 * "Nearest" is per DIRECTORY, and the first directory holding either name ends
 * the walk — there is no falling through to an ancestor. Measured: with an
 * ancestor `tsconfig.json` declaring both emit settings and a nearer, EMPTY
 * `jsconfig.json`, esbuild compiles under no settings at all. A nearer config
 * that declares nothing therefore blanks an ancestor that declares everything,
 * and a search that treated the empty one as "nothing found" would inherit
 * settings esbuild does not. Within a single directory `tsconfig.json` wins,
 * measured in both directions so the preference cannot be read off a coincidence.
 *
 * The rule to match is esbuild's, not one that merely sounds safer. Where the
 * two differ, the difference IS the defect.
 */
export function findTsconfig(fromDir: string): string | undefined {
  if (insideNodeModules(fromDir)) return undefined;

  let dir = fromDir;
  for (;;) {
    const found = firstExisting(CONFIG_NAMES.map((name) => join(dir, name)));
    if (found !== undefined) return found;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The settings governing files in `fromDir`, ready to hand to esbuild — or
 * undefined when the project declares none, which must build exactly as it did
 * before any of this existed.
 *
 * `cache` holds one answer per directory, so a bundle of many files under one
 * tsconfig costs one filesystem walk and one read rather than one per file. An
 * absent tsconfig is cached as such, so the walk is not repeated either.
 */
export function projectTsconfigRaw(
  fromDir: string,
  cache: Map<string, TsconfigRaw | undefined>,
): TsconfigRaw | undefined {
  const cached = cache.get(fromDir);
  if (cached !== undefined || cache.has(fromDir)) return cached;

  const file = findTsconfig(fromDir);
  const raw = file === undefined ? undefined : { compilerOptions: readCompilerOptions(file) };

  cache.set(fromDir, raw);
  return raw;
}

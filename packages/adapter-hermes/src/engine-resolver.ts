import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type EngineResolution,
  type HermesEngine,
  type HermesPinSource,
  type HermesRef,
  lookupPinnedRefs,
  type PinnedRefs,
  parseHermesTag,
  parseVersionProperties,
  selectHermesEngine,
} from '@argus/core';

/**
 * Reads the Hermes engine pinned by the user's React Native install.
 *
 * All parsing lives in `@argus/core` (pure); this module is the I/O half — the
 * upward walk to `node_modules/react-native/`, the four file reads, and the
 * fallback to the offline lookup table.
 *
 * Sources, in precedence order (a source only fills engine slots still empty,
 * so `version.properties` can pin both engines at once and later files fill
 * only the gaps):
 *
 *  1. `sdks/hermes-engine/version.properties`  (RN 0.82+)
 *  2. `sdks/.hermesv1version`                  (RN 0.83+)
 *  3. `sdks/.hermesversion`                    (RN 0.69+)
 *  4. `package.json` -> dependencies['hermes-compiler']  (RN 0.83+)
 */

/**
 * LOWERCASE. React Native ships `.hermesv1version`, not `.hermesV1version`.
 * A capital `V` resolves anyway on case-insensitive filesystems (macOS APFS)
 * but silently misses on case-sensitive ones (Linux CI), falling through to the
 * legacy pin. Do not "fix" this constant's casing.
 */
const HERMES_V1_VERSION_FILE = '.hermesv1version';
const HERMES_VERSION_FILE = '.hermesversion';
const VERSION_PROPERTIES_PATH = ['hermes-engine', 'version.properties'];
const HERMES_COMPILER_DEP = 'hermes-compiler';

export interface ResolveEngineOptions {
  /** Directory to start the upward walk from. Defaults to `process.cwd()`. */
  startDir?: string;
  /** Explicit engine preference. Omit to use the default policy (prefer V1). */
  engine?: HermesEngine;
  /**
   * React Native version to fall back on when no install can be found on disk.
   * Ignored when an install IS found — the install's own version wins.
   */
  rnVersion?: string;
}

/**
 * Result of a resolution attempt.
 *
 * Not finding anything is a normal outcome, not an exception: `unresolved` and
 * `unavailable` are values. Genuine I/O errors (permissions, etc.) still throw.
 */
export type EngineResolutionOutcome =
  | { kind: 'resolved'; resolution: EngineResolution }
  | {
      kind: 'unavailable';
      requested: HermesEngine;
      available: HermesEngine[];
      rnVersion?: string;
      reactNativeDir?: string;
    }
  | {
      kind: 'unresolved';
      reason: 'no-react-native-install' | 'no-pins-found';
      rnVersion?: string;
      reactNativeDir?: string;
    };

/** A pin plus the source it came from, tracked per engine during collection. */
interface SourcedRef {
  ref: HermesRef;
  source: HermesPinSource;
}

interface SourcedPins {
  legacy?: SourcedRef;
  v1?: SourcedRef;
}

/** Resolve which Hermes engine build the project at `startDir` pins. */
export function resolveHermesEngine(options: ResolveEngineOptions = {}): EngineResolutionOutcome {
  const startDir = options.startDir ?? process.cwd();
  const reactNativeDir = findReactNativeDir(startDir);

  if (reactNativeDir === undefined) {
    if (options.rnVersion === undefined) {
      return { kind: 'unresolved', reason: 'no-react-native-install' };
    }
    return fromFallbackTable(options.rnVersion, options.engine, undefined);
  }

  const pkg = readPackageJson(reactNativeDir);
  const rnVersion = readRnVersion(pkg) ?? options.rnVersion;
  const pins = collectPins(reactNativeDir, pkg);

  const selection = selectHermesEngine(toPinnedRefs(pins), options.engine);

  if (selection.kind === 'selected') {
    const chosen = pins[selection.ref.engine];
    if (chosen !== undefined) {
      return {
        kind: 'resolved',
        resolution: { ref: chosen.ref, source: chosen.source, rnVersion },
      };
    }
  }

  if (selection.kind === 'unavailable') {
    // The project IS readable and simply does not pin the requested engine.
    // Do not silently upgrade to the table — the caller asked for a specific
    // engine and deserves the chance to warn.
    return {
      kind: 'unavailable',
      requested: selection.requested,
      available: selection.available,
      rnVersion,
      reactNativeDir,
    };
  }

  // An install exists but pins nothing readable. Its own version is the best
  // key we have for the offline table.
  if (rnVersion !== undefined) {
    return fromFallbackTable(rnVersion, options.engine, reactNativeDir);
  }
  return { kind: 'unresolved', reason: 'no-pins-found', reactNativeDir };
}

/** Resolve from the offline lookup table alone. */
function fromFallbackTable(
  rnVersion: string,
  engine: HermesEngine | undefined,
  reactNativeDir: string | undefined,
): EngineResolutionOutcome {
  const selection = selectHermesEngine(lookupPinnedRefs(rnVersion), engine);

  if (selection.kind === 'selected') {
    return {
      kind: 'resolved',
      resolution: { ref: selection.ref, source: 'fallback-table', rnVersion },
    };
  }
  if (selection.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      requested: selection.requested,
      available: selection.available,
      rnVersion,
      reactNativeDir,
    };
  }
  return { kind: 'unresolved', reason: 'no-pins-found', rnVersion, reactNativeDir };
}

/** Walk up from `startDir` to the nearest `node_modules/react-native/`. */
function findReactNativeDir(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', 'react-native');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Read every known pin source, earliest source winning per engine slot. */
function collectPins(reactNativeDir: string, pkg: PackageJson | undefined): SourcedPins {
  const pins: SourcedPins = {};
  const sdks = join(reactNativeDir, 'sdks');

  const properties = readFileIfPresent(join(sdks, ...VERSION_PROPERTIES_PATH));
  if (properties !== undefined) {
    const parsed = parseVersionProperties(properties);
    addPin(pins, parsed.legacy, 'version.properties');
    addPin(pins, parsed.v1, 'version.properties', 'v1');
  }

  addPin(pins, readFileIfPresent(join(sdks, HERMES_V1_VERSION_FILE)), 'hermesv1version', 'v1');
  addPin(pins, readFileIfPresent(join(sdks, HERMES_VERSION_FILE)), 'hermesversion');
  addPin(pins, readHermesCompilerVersion(pkg), 'hermes-compiler');

  return pins;
}

/**
 * Parse `raw` and file it under the engine it resolves to, unless that slot is
 * already filled by a higher-precedence source.
 *
 * `engineHint` is passed ONLY for sources whose name makes the engine explicit;
 * shape-classified sources self-correct if they ever hold the other engine.
 */
function addPin(
  pins: SourcedPins,
  raw: string | undefined,
  source: HermesPinSource,
  engineHint?: HermesEngine,
): void {
  if (raw === undefined) return;

  const ref = parseHermesTag(raw, engineHint);
  if (ref === undefined) return;
  if (pins[ref.engine] !== undefined) return;

  pins[ref.engine] = { ref, source };
}

function toPinnedRefs(pins: SourcedPins): PinnedRefs {
  const out: PinnedRefs = {};
  if (pins.legacy !== undefined) out.legacy = pins.legacy.ref;
  if (pins.v1 !== undefined) out.v1 = pins.v1.ref;
  return out;
}

type PackageJson = Record<string, unknown>;

function readPackageJson(reactNativeDir: string): PackageJson | undefined {
  const raw = readFileIfPresent(join(reactNativeDir, 'package.json'));
  if (raw === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return parsed as PackageJson;
  } catch {
    // A malformed manifest yields no pin information. Reporting it is not this
    // resolver's job; the other sources may still answer.
    return undefined;
  }
}

function readRnVersion(pkg: PackageJson | undefined): string | undefined {
  const version = pkg?.version;
  if (typeof version !== 'string') return undefined;

  const trimmed = version.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** npm range operators that may decorate a dependency version. */
const RANGE_PREFIX_RE = /^[\s^~=<>]+/;

function readHermesCompilerVersion(pkg: PackageJson | undefined): string | undefined {
  const deps = pkg?.dependencies;
  if (typeof deps !== 'object' || deps === null) return undefined;

  const raw = (deps as Record<string, unknown>)[HERMES_COMPILER_DEP];
  if (typeof raw !== 'string') return undefined;

  const cleaned = raw.trim().replace(RANGE_PREFIX_RE, '');
  return cleaned.length === 0 ? undefined : cleaned;
}

/** Read a file, treating "not there" as a miss and anything else as a real error. */
function readFileIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined;
    throw err;
  }
}

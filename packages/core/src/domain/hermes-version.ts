/**
 * Hermes engine/version domain logic — PURE. No filesystem, no process, no
 * adapter imports. The I/O that feeds these parsers lives in `@arguslab/hermes`.
 *
 * React Native pins TWO Hermes engines from RN 0.83 onward: the legacy engine
 * and Hermes V1 (Static Hermes). RN 0.84 made V1 the default; RN 0.87 dropped
 * legacy entirely. A project can therefore pin one engine, both, or neither.
 *
 * Two tag schemes exist and both must parse:
 *  - date-based (RN 0.69–0.82): `hermes-2025-07-24-RNv0.80.2-<sha>`
 *  - semver     (RN 0.83+):     `hermes-v0.17.0`, `hermes-v250829098.0.16`
 *
 * The tag does NOT track the RN patch version (react-native@0.72.17 ships a tag
 * reading `RNv0.72.14`). Treat tag contents as opaque; never parse an RN version
 * back out of them.
 */

/** Which Hermes engine a pin refers to. */
export type HermesEngine = 'legacy' | 'v1';

/**
 * Every engine name, as a runtime value.
 *
 * The type above cannot be enumerated at run time, but both the `--engine` flag
 * and the config file have to reject a name that does not exist rather than
 * quietly running the other engine. Keeping the list beside the type is what
 * stops the two validators from drifting apart.
 */
export const ENGINE_VALUES: readonly HermesEngine[] = ['legacy', 'v1'];

/** A resolved reference to a Hermes engine build. */
export interface HermesRef {
  /** Which engine this ref builds. */
  engine: HermesEngine;
  /** Canonical git ref, e.g. 'hermes-v250829098.0.16'. */
  tag: string;
  /** Bare version without tag decoration, e.g. '250829098.0.16'. */
  version: string;
}

/** The Hermes refs pinned for each engine by a given source or RN release. */
export interface PinnedRefs {
  legacy?: HermesRef;
  v1?: HermesRef;
}

/** Where a resolved pin was read from. */
export type HermesPinSource =
  | 'version.properties'
  | 'hermesv1version'
  | 'hermesversion'
  | 'hermes-compiler'
  | 'fallback-table';

/** A fully resolved engine choice: which ref, read from where, for which RN. */
export interface EngineResolution {
  /** The engine ref that was selected. */
  ref: HermesRef;
  /** Which of the four project sources (or the table) supplied it. */
  source: HermesPinSource;
  /** Detected React Native version, when known. */
  rnVersion?: string;
}

/**
 * Outcome of the engine-selection policy.
 *
 * `unavailable` exists so a caller that asked for a specific engine the project
 * does not pin can warn, instead of silently getting the other engine.
 */
export type EngineSelection =
  | { kind: 'selected'; ref: HermesRef }
  | { kind: 'unavailable'; requested: HermesEngine; available: HermesEngine[] }
  | { kind: 'none' };

const TAG_PREFIX = 'hermes-';

/** `v0.17.0`, `0.17.0`, `250829098.0.16`, with an optional prerelease/build tail. */
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[+-][0-9A-Za-z.+-]*)?$/;

/** `2025-07-24-RNv0.80.2-<sha>` and friends. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:-[0-9A-Za-z._-]+)?$/;

/** A bare commit SHA — RN 0.82 pins its V1 engine this way. */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/**
 * V1 versions carry a datestamp-like major (`250829098.0.16`, `260318099.0.1`);
 * legacy semver majors are single digit (`0.17.0`, `1.0.0`).
 */
const V1_MAJOR_MIN_DIGITS = 9;

/**
 * Parse a Hermes tag or bare version into a `HermesRef`.
 *
 * Accepts both tag schemes, with or without the `hermes-` prefix, and tolerates
 * surrounding whitespace. Returns `undefined` for input that matches no known
 * scheme rather than throwing — a malformed pin is a resolution miss, not a
 * crash.
 *
 * @param raw - tag or version, e.g. 'hermes-v0.17.0', '250829098.0.16'.
 * @param engineHint - forces the engine when the CALLER has authoritative
 *   provenance that shape cannot supply. Use it only for explicitly-V1 sources
 *   (`.hermesv1version`, `HERMES_V1_VERSION_NAME`), whose value may be a bare
 *   commit SHA that carries no engine signal. Everything else is classified by
 *   shape, so a source that unexpectedly holds the other engine self-corrects.
 */
export function parseHermesTag(raw: string, engineHint?: HermesEngine): HermesRef | undefined {
  const trimmed = raw.trim();
  const body = trimmed.startsWith(TAG_PREFIX) ? trimmed.slice(TAG_PREFIX.length) : trimmed;
  if (body.length === 0) return undefined;

  const semver = SEMVER_RE.exec(body);
  if (semver !== null) {
    const version = body.startsWith('v') ? body.slice(1) : body;
    const inferred: HermesEngine = semver[1].length >= V1_MAJOR_MIN_DIGITS ? 'v1' : 'legacy';
    return { engine: engineHint ?? inferred, tag: `${TAG_PREFIX}v${version}`, version };
  }

  if (DATE_RE.test(body)) {
    // Date-based pins are always the legacy engine.
    return { engine: engineHint ?? 'legacy', tag: TAG_PREFIX + body, version: body };
  }

  if (SHA_RE.test(body)) {
    // A commit SHA is its own git ref — do not synthesize a tag name around it.
    return { engine: engineHint ?? 'legacy', tag: trimmed, version: body };
  }

  return undefined;
}

/**
 * Derive the release version to bake into a source build of `raw`.
 *
 * facebook/hermes `CMakeLists.txt` declares `project(Hermes VERSION 1.0.0)` and
 * defaults `HERMES_RELEASE_VERSION` to it, so a plain clone of ANY tag reports
 * `1.0.0` unless the real version is injected at configure time. That default is
 * why the legacy binary vendored in this repo reports `0.12.0` for what is
 * actually `hermes-v0.17.0`. The publish pipeline injects the version; a source
 * build has to do the same or its `--version` output is fiction.
 *
 * Returns `undefined` when the ref carries no release version: a bare commit SHA
 * (how RN 0.82 pins its V1 engine) is a git ref, not a version, and baking one
 * in would make the binary misreport itself.
 */
export function releaseVersionForRef(raw: string): string | undefined {
  const ref = parseHermesTag(raw);
  if (ref === undefined) return undefined;

  const trimmed = raw.trim();
  const body = trimmed.startsWith(TAG_PREFIX) ? trimmed.slice(TAG_PREFIX.length) : trimmed;
  if (SHA_RE.test(body)) return undefined;

  return ref.version;
}

// ---------------------------------------------------------------------------
// `hermes --version` output
// ---------------------------------------------------------------------------

/** What a Hermes binary reports about itself via `--version`. */
export interface HermesVersionInfo {
  /** `Hermes release version` value, e.g. '1.0.0'. Absent when not reported. */
  releaseVersion?: string;
  /**
   * `HBC bytecode version` value: 96 for the legacy engine, 98 for Hermes V1.
   * This is what distinguishes the two engines at runtime — a V1 VM refuses
   * legacy bytecode outright ('Wrong bytecode version. Expected 98 but got 96'),
   * so a mismatch always fails loudly rather than misbehaving silently.
   */
  bytecodeVersion?: number;
}

const RELEASE_VERSION_LABEL = 'Hermes release version:';
const BYTECODE_VERSION_LABEL = 'HBC bytecode version:';

/** Bytecode versions are plain integers; anything else is not one. */
const DIGITS_RE = /^\d+$/;

/**
 * Parse the output of `hermes --version`.
 *
 * The output is more than a version string: it opens with an LLVM preamble whose
 * own `LLVH version 8.0.0svn` line is NOT the Hermes version, and closes with a
 * `Features:` block. Both fields are therefore matched on their exact labels,
 * line by line, so the preamble cannot be mistaken for an answer.
 *
 * Missing or malformed fields are omitted rather than throwing — a binary that
 * reports nothing recognisable is 'version unknown', not a crash.
 */
export function parseHermesVersionOutput(output: string): HermesVersionInfo {
  const info: HermesVersionInfo = {};

  // Splitting on '\n' and trimming each line makes CRLF input fall out for free.
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();

    if (info.releaseVersion === undefined && line.startsWith(RELEASE_VERSION_LABEL)) {
      const value = line.slice(RELEASE_VERSION_LABEL.length).trim();
      if (value.length > 0) info.releaseVersion = value;
      continue;
    }

    if (info.bytecodeVersion === undefined && line.startsWith(BYTECODE_VERSION_LABEL)) {
      const value = line.slice(BYTECODE_VERSION_LABEL.length).trim();
      if (DIGITS_RE.test(value)) info.bytecodeVersion = Number.parseInt(value, 10);
    }
  }

  return info;
}

const LEGACY_PROPERTY_KEY = 'HERMES_VERSION_NAME';
const V1_PROPERTY_KEY = 'HERMES_V1_VERSION_NAME';

/**
 * Parse `sdks/hermes-engine/version.properties` (RN 0.82+).
 *
 * Minimal java-properties handling: `KEY=VALUE` lines, `#` and `!` comments,
 * blank lines, whitespace around `=`, and CRLF endings. Empty values are
 * treated as absent. Unknown keys are ignored.
 */
export function parseVersionProperties(contents: string): { legacy?: string; v1?: string } {
  const out: { legacy?: string; v1?: string } = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const value = line.slice(eq + 1).trim();
    if (value.length === 0) continue;

    const key = line.slice(0, eq).trim();
    if (key === LEGACY_PROPERTY_KEY) out.legacy = value;
    else if (key === V1_PROPERTY_KEY) out.v1 = value;
  }
  return out;
}

/**
 * Decide which engine to use given what a project pins.
 *
 * Default policy: prefer V1 when one is pinned, fall back to legacy. An
 * explicit preference wins, but asking for an engine that is not pinned yields
 * `unavailable` rather than silently succeeding with the other engine.
 */
export function selectHermesEngine(pins: PinnedRefs, preference?: HermesEngine): EngineSelection {
  const available: HermesEngine[] = [];
  if (pins.v1 !== undefined) available.push('v1');
  if (pins.legacy !== undefined) available.push('legacy');

  if (preference !== undefined) {
    const ref = pins[preference];
    if (ref !== undefined) return { kind: 'selected', ref };
    return { kind: 'unavailable', requested: preference, available };
  }

  if (pins.v1 !== undefined) return { kind: 'selected', ref: pins.v1 };
  if (pins.legacy !== undefined) return { kind: 'selected', ref: pins.legacy };
  return { kind: 'none' };
}

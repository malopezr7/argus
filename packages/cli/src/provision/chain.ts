import { join } from 'node:path';
import {
  BUNDLED_LEGACY_VM_SEGMENTS,
  type HermesBinPlatform,
  type HermesRef,
  hermesCacheBinarySegments,
  hermesReleasePlatform,
  hermesReleaseTag,
  PROJECT_VENDORED_VM_SEGMENTS,
} from '@argus/core';

/**
 * The provisioning chain: decide WHERE the Hermes binary comes from.
 *
 * Pure except for the injected `probe`, so the precedence rules are unit-tested
 * without a filesystem. Actually resolving a binary (running `--version`,
 * cloning, building) belongs to `provision.ts`.
 *
 * Order is "most explicit first" — anything the user put there outranks
 * anything Argus produced:
 *   1. explicit         — `--hermes` / `ARGUS_HERMES`
 *   2. project-vendored — `./.hermes/hermes` in the project under test
 *   3. cache            — an already-built binary in `~/.argus/cache`
 *   4. bundled-legacy   — the VM inside the react-native tarball (RN 0.73-0.82)
 *   5. prebuilt         — downloaded from an Argus GitHub Release
 *   6. source-build     — opt-in via `--provision`, never silent
 */

export type ProvisionSourceKind =
  | 'explicit'
  | 'project-vendored'
  | 'cache'
  | 'bundled-legacy'
  | 'prebuilt'
  | 'source-build';

/** Which explicit mechanism supplied a path — reported back to the user verbatim. */
export type ExplicitOrigin = 'flag' | 'env';

export interface ExplicitPath {
  path: string;
  origin: ExplicitOrigin;
}

export interface ChainInput {
  /** A path the user named outright. Wins over everything, unconditionally. */
  explicit?: ExplicitPath;
  /** The engine ref the project pins. Absent when engine resolution failed. */
  ref?: HermesRef;
  /** Root of the project under test — where `./.hermes/hermes` is looked for. */
  projectDir: string;
  /** Home directory the cache is rooted at. */
  homeDir: string;
  /** The `node_modules/react-native` directory the engine resolver found. */
  reactNativeDir?: string;
  /** Host platform (`process.platform`). The bundled VM is macOS-only. */
  platform: string;
  /** Host architecture (`process.arch`). Decides which prebuilt applies. */
  arch: string;
  /** True when `--provision` authorised a source build. */
  allowSourceBuild: boolean;
  /**
   * Why a prebuilt download already failed, when one was tried and could not
   * supply a binary.
   *
   * Whether an asset exists is only knowable over the network, which this
   * function must not do. So the caller downloads, and on an ordinary
   * "nothing published" outcome walks the chain again with the reason set —
   * the step is then skipped with that reason, and the rest of the chain
   * continues exactly as if it had never applied.
   */
  prebuiltUnavailable?: string;
}

/** A source that did not supply a binary, and why. Feeds the failure message. */
export interface AttemptedSource {
  kind: ProvisionSourceKind;
  /** The location probed, when this source is path-shaped. */
  path?: string;
  /** Human-readable reason this source produced nothing. */
  reason: string;
}

/** The source that won. Carries exactly what the adapter needs to act. */
export type SelectedSource =
  | { kind: 'explicit'; origin: ExplicitOrigin; path: string }
  | { kind: 'project-vendored'; path: string }
  | { kind: 'cache'; path: string; ref: HermesRef }
  | { kind: 'bundled-legacy'; path: string; ref: HermesRef }
  | { kind: 'prebuilt'; ref: HermesRef; platform: HermesBinPlatform }
  | { kind: 'source-build'; ref: HermesRef };

export type ChainOutcome =
  | { kind: 'selected'; source: SelectedSource; attempted: AttemptedSource[] }
  | { kind: 'exhausted'; attempted: AttemptedSource[] };

/** Answers "is there an executable file here?". Injected to keep selection pure. */
export type ExecutableProbe = (path: string) => boolean;

/** Absolute path of the cached build for `ref`. */
export function cacheBinaryPath(homeDir: string, ref: HermesRef): string {
  return join(homeDir, ...hermesCacheBinarySegments(ref.tag));
}

/** Absolute path of a binary vendored in the project under test. */
export function projectVendoredPath(projectDir: string): string {
  return join(projectDir, ...PROJECT_VENDORED_VM_SEGMENTS);
}

/** Absolute path of the legacy VM vendored in a React Native install. */
export function bundledLegacyVmPath(reactNativeDir: string): string {
  return join(reactNativeDir, ...BUNDLED_LEGACY_VM_SEGMENTS);
}

/**
 * Walk the chain and return the first source that can supply a binary.
 *
 * The explicit path is NOT probed. A user who named a path is entitled to an
 * error about THAT path rather than a silent fallback onto some other binary,
 * so a bad `--hermes` value fails later in the adapter with its own message
 * instead of quietly running different code than was asked for.
 */
export function selectProvisionSource(input: ChainInput, probe: ExecutableProbe): ChainOutcome {
  const attempted: AttemptedSource[] = [];

  if (input.explicit !== undefined) {
    return {
      kind: 'selected',
      source: { kind: 'explicit', origin: input.explicit.origin, path: input.explicit.path },
      attempted,
    };
  }

  const { ref } = input;

  // 2. Project-vendored — probed, unlike an explicit path: its absence is the
  //    normal case, so falling through is right rather than an error.
  const vendored = projectVendoredPath(input.projectDir);
  if (probe(vendored)) {
    return {
      kind: 'selected',
      source: { kind: 'project-vendored', path: vendored },
      attempted,
    };
  }
  attempted.push({ kind: 'project-vendored', path: vendored, reason: 'not present' });

  // 3. Cache — an existence check only. Rebuilding here would make a slow,
  //    network-bound side effect happen without the user asking for it.
  if (ref === undefined) {
    attempted.push({ kind: 'cache', reason: 'no engine resolved, so no cache key to look up' });
  } else {
    const path = cacheBinaryPath(input.homeDir, ref);
    if (probe(path)) {
      return { kind: 'selected', source: { kind: 'cache', path, ref }, attempted };
    }
    attempted.push({ kind: 'cache', path, reason: 'no cached build' });
  }

  // 4. Bundled legacy VM — free, exact, and already on disk when it applies.
  const bundled = attemptBundledLegacy(input, probe);
  if (bundled.kind === 'selected') {
    return { kind: 'selected', source: bundled.source, attempted };
  }
  attempted.push(bundled.attempt);

  // 5. Prebuilt — a download, so it ranks below everything already on disk but
  //    above a build the user has to wait several minutes for.
  const prebuilt = attemptPrebuilt(input);
  if (prebuilt.kind === 'selected') {
    return { kind: 'selected', source: prebuilt.source, attempted };
  }
  attempted.push(prebuilt.attempt);

  // 6. Source build — multi-minute, needs git/cmake/ninja, so it happens only
  //    when the user explicitly authorised it.
  if (ref === undefined) {
    attempted.push({
      kind: 'source-build',
      reason: 'no engine resolved, so there is no ref to build',
    });
  } else if (!input.allowSourceBuild) {
    attempted.push({ kind: 'source-build', reason: 'not authorised — pass --provision' });
  } else {
    return { kind: 'selected', source: { kind: 'source-build', ref }, attempted };
  }

  return { kind: 'exhausted', attempted };
}

type SourceAttempt =
  | { kind: 'selected'; source: SelectedSource }
  | { kind: 'skipped'; attempt: AttemptedSource };

/**
 * The prebuilt applies only when a matching asset could exist: there is a ref,
 * that ref can name a release version, and the host is one of the published
 * platforms. Each miss reports its own reason so the failure message explains
 * itself rather than saying "unavailable".
 *
 * Whether the asset is actually published is a network question and is answered
 * by the adapter — see `prebuiltUnavailable` on `ChainInput`.
 */
function attemptPrebuilt(input: ChainInput): SourceAttempt {
  const skip = (reason: string): SourceAttempt => ({
    kind: 'skipped',
    attempt: { kind: 'prebuilt', reason },
  });

  if (input.prebuiltUnavailable !== undefined) return skip(input.prebuiltUnavailable);

  const { ref } = input;
  if (ref === undefined) return skip('no engine resolved, so there is no ref to download');
  if (hermesReleaseTag(ref.tag) === undefined) {
    return skip(
      `${ref.tag} cannot name a release version — date-based refs and bare ` +
        'commit SHAs are not published as prebuilts',
    );
  }

  const platform = hermesReleasePlatform(input.platform, input.arch);
  if (platform === undefined) {
    return skip(`no prebuilt is published for ${input.platform}-${input.arch}`);
  }

  return { kind: 'selected', source: { kind: 'prebuilt', ref, platform } };
}

/**
 * The bundled VM applies only when every one of its preconditions holds: the
 * project targets legacy, an install was found, the host is macOS (the binary
 * is Mach-O), and the file is actually there and executable. Each miss reports
 * its own reason so the failure message explains itself.
 */
function attemptBundledLegacy(input: ChainInput, probe: ExecutableProbe): SourceAttempt {
  const { ref, reactNativeDir, platform } = input;
  const skip = (reason: string): SourceAttempt => ({
    kind: 'skipped',
    attempt: { kind: 'bundled-legacy', reason },
  });

  if (ref === undefined) return skip('no engine resolved');
  if (ref.engine !== 'legacy')
    return skip(`only ships the legacy VM, but ${ref.engine} is targeted`);
  if (reactNativeDir === undefined) return skip('no react-native install found');
  if (platform !== 'darwin') return skip(`macOS-only binary, host is ${platform}`);

  const path = bundledLegacyVmPath(reactNativeDir);
  if (!probe(path)) {
    return {
      kind: 'skipped',
      attempt: {
        kind: 'bundled-legacy',
        path,
        reason: 'not present or not executable (shipped by React Native 0.73 to 0.82 only)',
      },
    };
  }
  return { kind: 'selected', source: { kind: 'bundled-legacy', path, ref } };
}

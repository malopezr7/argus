import { accessSync, constants, statSync } from 'node:fs';
import type { HermesBinary, HermesEngine, HermesProvisioner } from '@argus/core';
import { checkEngineFidelity } from '@argus/core';
import {
  type EngineResolutionOutcome,
  resolveHermesEngine,
} from '@argus/hermes/engine-resolver.js';
import { LocalPathAdapter } from '@argus/hermes/local-path-adapter.js';
import { SourceBuildAdapter } from '@argus/hermes/source-build-adapter.js';
import { errMsg } from '../errors.js';
import { type ExecutableProbe, type SelectedSource, selectProvisionSource } from './chain.js';
import { detectHostTarget } from './host-target.js';
import {
  type EngineContext,
  formatEngineUnavailable,
  formatFidelityWarning,
  formatProvisionFailure,
  formatProvisionSummary,
} from './messages.js';

/**
 * Provisioning: turn "which engine does this project target?" into a Hermes
 * binary on disk, and say out loud which one was used.
 *
 * The I/O half of the chain. Ordering lives in `chain.ts` and wording in
 * `messages.ts`, both pure; this module only touches the filesystem, runs the
 * adapters, and assembles the result.
 */

export interface ProvisionOptions {
  /** `--hermes <path>`. Takes precedence over the environment variable. */
  hermesFlagPath?: string;
  /** `ARGUS_HERMES`. */
  hermesEnvPath?: string;
  /** `--engine <legacy|v1>`; omit to use the default policy (prefer V1). */
  engine?: HermesEngine;
  /** `--provision` — authorises the multi-minute source build. */
  allowSourceBuild: boolean;
  /** Directory the search for a React Native install starts from. */
  startDir: string;
  /** Home directory the build cache is rooted at. */
  homeDir: string;
  /** `process.platform`. */
  platform: string;
  /** `process.arch`. */
  arch: string;
  /** Override the executable check. Tests inject a fake; runtime uses the real one. */
  probe?: ExecutableProbe;
}

export type ProvisionResult =
  | {
      kind: 'provisioned';
      binary: HermesBinary;
      /** One-line record of engine, tag, source and path. */
      summary: string;
      /** Engine-mismatch warning, when the binary is not the targeted engine. */
      warning?: string;
    }
  /** Nothing could supply a binary, or an adapter failed. Exit code 2. */
  | { kind: 'failed'; message: string }
  /** The user asked for an engine the project does not pin. Exit code 2. */
  | { kind: 'usage-error'; message: string };

/** True when `path` is an existing file the current user may execute. */
export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    // Missing, unreadable, a directory, or not executable — all mean "not a
    // binary we can run", which is the only distinction the chain needs.
    return false;
  }
}

/** Flatten a resolver outcome into the context every message needs. */
function toEngineContext(outcome: EngineResolutionOutcome, startDir: string): EngineContext {
  if (outcome.kind === 'resolved') {
    const { ref, source, rnVersion } = outcome.resolution;
    return {
      ref: { engine: ref.engine, tag: ref.tag },
      pinSource: source,
      ...(rnVersion === undefined ? {} : { rnVersion }),
      startDir,
    };
  }
  if (outcome.kind === 'unresolved') {
    return {
      unresolvedReason: outcome.reason,
      ...(outcome.rnVersion === undefined ? {} : { rnVersion: outcome.rnVersion }),
      startDir,
    };
  }
  return { startDir };
}

/**
 * Pick the adapter for a selected source.
 *
 * Explicit paths, cache hits and the bundled VM are all "a binary that already
 * exists at a path", which is exactly what `LocalPathAdapter` models — the
 * difference between them is how the path was found, not how it is used. Only
 * the opt-in source build needs the heavyweight adapter.
 */
function adapterFor(source: SelectedSource): HermesProvisioner {
  if (source.kind === 'source-build') return new SourceBuildAdapter(source.ref.tag);
  return new LocalPathAdapter(source.path);
}

/**
 * Resolve the engine the project targets, find a binary for it, and check that
 * the binary really is that engine.
 *
 * Never throws for an expected outcome: a missing binary, an unbuildable
 * engine, and an impossible `--engine` request are all values the caller
 * renders and exits on.
 */
export async function provisionHermes(options: ProvisionOptions): Promise<ProvisionResult> {
  const explicitPath = options.hermesFlagPath ?? options.hermesEnvPath;
  const explicit =
    explicitPath === undefined
      ? undefined
      : {
          path: explicitPath,
          origin: options.hermesFlagPath === undefined ? ('env' as const) : ('flag' as const),
        };

  const outcome = resolveHermesEngine({
    startDir: options.startDir,
    ...(options.engine === undefined ? {} : { engine: options.engine }),
  });

  // Asking for an engine the project does not pin is a mistake worth stopping
  // for. Substituting the other engine would produce a green run that proves
  // nothing about the engine the user actually asked about.
  if (outcome.kind === 'unavailable') {
    return {
      kind: 'usage-error',
      message: formatEngineUnavailable(outcome.requested, outcome.available, outcome.rnVersion),
    };
  }

  const context = toEngineContext(outcome, options.startDir);
  const ref = outcome.kind === 'resolved' ? outcome.resolution.ref : undefined;
  const reactNativeDir = outcome.kind === 'resolved' ? outcome.reactNativeDir : undefined;

  const chain = selectProvisionSource(
    {
      ...(explicit === undefined ? {} : { explicit }),
      ...(ref === undefined ? {} : { ref }),
      projectDir: options.startDir,
      homeDir: options.homeDir,
      ...(reactNativeDir === undefined ? {} : { reactNativeDir }),
      platform: options.platform,
      allowSourceBuild: options.allowSourceBuild,
    },
    options.probe ?? isExecutableFile,
  );

  if (chain.kind === 'exhausted') {
    return { kind: 'failed', message: formatProvisionFailure(context, chain.attempted) };
  }

  const target = detectHostTarget({
    platform: options.platform,
    arch: options.arch,
    ...(context.rnVersion === undefined ? {} : { rnVersion: context.rnVersion }),
    ...(ref === undefined ? {} : { hermesVersion: ref.tag }),
  });

  let binary: HermesBinary;
  try {
    binary = await adapterFor(chain.source).resolve(target);
  } catch (e) {
    return {
      kind: 'failed',
      message: `✗ INFRASTRUCTURE FAILURE [provision] ${errMsg(e)}\n`,
    };
  }

  const warning = formatFidelityWarning(checkEngineFidelity(ref?.engine, binary), binary);
  return {
    kind: 'provisioned',
    binary,
    summary: formatProvisionSummary(chain.source, context, binary),
    ...(warning === '' ? {} : { warning }),
  };
}

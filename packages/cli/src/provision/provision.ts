import { accessSync, constants, statSync } from 'node:fs';
import type { EngineTarget, HermesBinary, HermesEngine, HermesProvisioner } from '@arguslab/core';
import { checkEngineFidelity, engineForBytecodeVersion } from '@arguslab/core';
import {
  type EngineResolutionOutcome,
  resolveHermesEngine,
} from '@arguslab/hermes/engine-resolver.js';
import { LocalPathAdapter } from '@arguslab/hermes/local-path-adapter.js';
import { PrebuiltAdapter, PrebuiltUnavailableError } from '@arguslab/hermes/prebuilt-adapter.js';
import type { AssetFetcher } from '@arguslab/hermes/prebuilt-assets.js';
import { SourceBuildAdapter } from '@arguslab/hermes/source-build-adapter.js';
import { errMsg } from '../errors.js';
import {
  type AttemptedSource,
  type ChainInput,
  type ExecutableProbe,
  type ExplicitPath,
  type SelectedSource,
  selectProvisionSource,
} from './chain.js';
import { detectHostTarget } from './host-target.js';
import {
  type EngineContext,
  formatAssumedEngineWarning,
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
  /**
   * A binary path the user named outright, and which of `--hermes`,
   * `ARGUS_HERMES` or the config file named it.
   *
   * Precedence between those three is settled upstream by `mergeConfig`, which
   * is the only place that resolves competing sources. Repeating that rule here
   * would give it two homes and one of them would eventually drift.
   */
  explicitHermes?: ExplicitPath;
  /** `--engine <legacy|v1>`; omit to run the engine the project's RN ships. */
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
  /**
   * Override the prebuilt download boundary. Tests inject a stub so no test
   * reaches the network; runtime uses real `fetch`.
   */
  fetchAsset?: AssetFetcher;
}

export type ProvisionResult =
  | {
      kind: 'provisioned';
      binary: HermesBinary;
      /**
       * The engine the bundle must be built for — see `effectiveEngine`.
       *
       * Distinct from the engine the project TARGETS: when a binary turns up
       * that is not the targeted engine, the bundle still has to be parseable
       * by the binary that will run it.
       */
      engine: HermesEngine;
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
    const { ref, source, rnVersion, assumedDefault } = outcome.resolution;
    return {
      ref: { engine: ref.engine, tag: ref.tag },
      pinSource: source,
      ...(rnVersion === undefined ? {} : { rnVersion }),
      ...(assumedDefault === undefined ? {} : { assumedDefault }),
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
 * the download and the opt-in source build need their own adapters.
 */
function adapterFor(source: SelectedSource, options: ProvisionOptions): HermesProvisioner {
  if (source.kind === 'source-build') return new SourceBuildAdapter(source.ref.tag);
  if (source.kind === 'prebuilt') {
    return new PrebuiltAdapter({
      ref: source.ref,
      homeDir: options.homeDir,
      ...(options.fetchAsset === undefined ? {} : { fetchAsset: options.fetchAsset }),
    });
  }
  return new LocalPathAdapter(source.path);
}

/**
 * The engine whose syntax the bundle has to be written in.
 *
 * The BINARY wins over the pin. Whatever the project targets, the binary on
 * disk is the process that will parse the bundle, and its bytecode version is
 * the one field that identifies it reliably. When those two disagree the run
 * already carries a fidelity warning; building for the pin as well would turn
 * that warning into a hard parse error on legacy.
 *
 * With no bytecode version the pin is the next best evidence, and with neither
 * the answer is legacy: its output runs on both VMs, so an unidentified binary
 * has exactly one choice that cannot produce a file nothing can parse.
 */
function effectiveEngine(binary: HermesBinary, targeted: HermesEngine | undefined): HermesEngine {
  const reported =
    binary.bytecodeVersion === undefined
      ? undefined
      : engineForBytecodeVersion(binary.bytecodeVersion);
  return reported ?? targeted ?? 'legacy';
}

/** Outcome of walking the chain and running whichever adapter it selected. */
type BinaryOutcome =
  | { kind: 'ok'; binary: HermesBinary; source: SelectedSource }
  | { kind: 'exhausted'; attempted: AttemptedSource[] }
  | { kind: 'adapter-failed'; message: string };

/**
 * Walk the chain, run the selected adapter, and retry past a prebuilt that
 * turned out not to exist.
 *
 * Whether an asset is published cannot be known without the network, and the
 * chain is pure, so "nothing published for this ref" surfaces here as a
 * `PrebuiltUnavailableError` after selection. Feeding the reason back into a
 * second walk is what makes that an ordinary fall-through rather than a hard
 * stop — every other step keeps its behaviour, and the failure message ends up
 * naming the real reason the download did not apply.
 *
 * The loop runs at most twice: the retry sets `prebuiltUnavailable`, which
 * makes the prebuilt step skip unconditionally.
 */
async function resolveBinary(
  base: ChainInput,
  target: EngineTarget,
  options: ProvisionOptions,
): Promise<BinaryOutcome> {
  let input = base;

  for (;;) {
    const chain = selectProvisionSource(input, options.probe ?? isExecutableFile);
    if (chain.kind === 'exhausted') return { kind: 'exhausted', attempted: chain.attempted };

    try {
      const binary = await adapterFor(chain.source, options).resolve(target);
      return { kind: 'ok', binary, source: chain.source };
    } catch (error) {
      if (chain.source.kind === 'prebuilt' && error instanceof PrebuiltUnavailableError) {
        input = { ...input, prebuiltUnavailable: errMsg(error) };
        continue;
      }
      return { kind: 'adapter-failed', message: errMsg(error) };
    }
  }
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
  const explicit = options.explicitHermes;

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

  const target = detectHostTarget({
    platform: options.platform,
    arch: options.arch,
    ...(context.rnVersion === undefined ? {} : { rnVersion: context.rnVersion }),
    ...(ref === undefined ? {} : { hermesVersion: ref.tag }),
  });

  const resolved = await resolveBinary(
    {
      ...(explicit === undefined ? {} : { explicit }),
      ...(ref === undefined ? {} : { ref }),
      projectDir: options.startDir,
      homeDir: options.homeDir,
      ...(reactNativeDir === undefined ? {} : { reactNativeDir }),
      platform: options.platform,
      arch: options.arch,
      allowSourceBuild: options.allowSourceBuild,
    },
    target,
    options,
  );

  if (resolved.kind === 'exhausted') {
    return { kind: 'failed', message: formatProvisionFailure(context, resolved.attempted) };
  }
  if (resolved.kind === 'adapter-failed') {
    return {
      kind: 'failed',
      message: `✗ INFRASTRUCTURE FAILURE [provision] ${resolved.message}\n`,
    };
  }

  const { binary } = resolved;
  // Both warnings can apply at once — a guessed engine says nothing about
  // whether the binary that turned up matches it — so neither hides the other.
  const warning = [
    formatAssumedEngineWarning(context),
    formatFidelityWarning(checkEngineFidelity(ref?.engine, binary), binary),
  ].join('');

  return {
    kind: 'provisioned',
    binary,
    engine: effectiveEngine(binary, ref?.engine),
    summary: formatProvisionSummary(resolved.source, context, binary),
    ...(warning === '' ? {} : { warning }),
  };
}

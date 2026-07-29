import type { EngineFidelity, HermesBinary, HermesEngine, HermesPinSource } from '@arguslab/core';
import { engineForBytecodeVersion } from '@arguslab/core';
import type { AttemptedSource, SelectedSource } from './chain.js';

/**
 * Every user-facing string the provisioning step emits, built by pure
 * functions so their exact wording is asserted by tests rather than eyeballed.
 *
 * Glyphs match the reporter's plain-unicode style (no colour dependency).
 */

/** What is known about the engine the project targets. */
export interface EngineContext {
  /** The resolved ref, when one was found. */
  ref?: { engine: HermesEngine; tag: string };
  /** Which project file supplied the pin. */
  pinSource?: HermesPinSource;
  /** React Native version detected in the project. */
  rnVersion?: string;
  /** Why nothing could be resolved, when nothing was. */
  unresolvedReason?: 'no-react-native-install' | 'no-pins-found';
  /** Directory the search started from — quoted so the user can orient. */
  startDir?: string;
}

/** Blank columns between the source name and its reason. */
const KIND_GUTTER = 2;

/**
 * Column width for the Tried block, derived from the entries actually listed.
 *
 * Deriving it rather than hardcoding a number means a source name longer than
 * the column can never swallow the separator and run into its own reason.
 */
function kindColumn(attempted: AttemptedSource[]): number {
  let widest = 0;
  for (const source of attempted) widest = Math.max(widest, source.kind.length);
  return widest + KIND_GUTTER;
}

/** `v1 hermes-v0.17.0 (pinned by .hermesversion, react-native 0.82.1)` */
function describeEngine(context: EngineContext): string {
  if (context.ref === undefined) {
    const reason =
      context.unresolvedReason === 'no-pins-found'
        ? 'a React Native install was found but pins no readable Hermes version'
        : 'no React Native install found';
    const from =
      context.startDir === undefined ? '' : ` (searched upward from ${context.startDir})`;
    return `unresolved — ${reason}${from}`;
  }

  const details: string[] = [];
  if (context.pinSource !== undefined) details.push(`pinned by ${context.pinSource}`);
  if (context.rnVersion !== undefined) details.push(`react-native ${context.rnVersion}`);
  const suffix = details.length === 0 ? '' : ` (${details.join(', ')})`;
  return `${context.ref.engine} ${context.ref.tag}${suffix}`;
}

/**
 * The message shown when the chain is exhausted.
 *
 * It answers the three questions a blocked user has: what was being looked for,
 * where Argus looked, and what to type next. There is no interactive prompt by
 * design — a test runner mostly runs in CI, where a prompt is a hang.
 */
export function formatProvisionFailure(
  context: EngineContext,
  attempted: AttemptedSource[],
): string {
  const lines: string[] = [
    '✗ INFRASTRUCTURE FAILURE [provision] No Hermes binary available.',
    `  Engine: ${describeEngine(context)}`,
    '  Tried:',
  ];

  const column = kindColumn(attempted);
  for (const source of attempted) {
    const where = source.path === undefined ? '' : `${source.path} — `;
    lines.push(`    ${source.kind.padEnd(column, ' ')}${where}${source.reason}`);
  }

  lines.push('  Fix it with one of:');
  if (context.ref !== undefined) {
    lines.push(
      `    argus --provision [globs...]   build Hermes ${context.ref.engine} ${context.ref.tag} from source (needs git, cmake, ninja)`,
    );
  }
  lines.push('    argus --hermes <path> [globs...]   use a Hermes binary you already have');
  lines.push('    ARGUS_HERMES=<path> argus [globs...]   the same, via the environment');
  lines.push('    vendor a binary at ./.hermes/hermes to have it picked up with no flag');
  if (context.ref === undefined) {
    lines.push(
      '    install react-native here so Argus can read the engine it pins, then --provision',
    );
  }

  return `${lines.join('\n')}\n`;
}

/** Short label naming the mechanism that supplied the binary. */
export function describeSource(source: SelectedSource): string {
  switch (source.kind) {
    case 'explicit':
      if (source.origin === 'flag') return '--hermes';
      return source.origin === 'env' ? 'ARGUS_HERMES' : 'argus.config';
    case 'project-vendored':
      return 'project .hermes';
    case 'cache':
      return 'cache';
    case 'bundled-legacy':
      return 'react-native bundled vm';
    case 'prebuilt':
      return `prebuilt ${source.platform.os}-${source.platform.cpu}`;
    case 'source-build':
      return 'source build';
  }
}

/**
 * One line recording which engine the tests actually ran on.
 *
 * Kept to a single line on purpose: its job is to survive in a CI log, where a
 * multi-line banner is noise but the engine identity is the difference between
 * a meaningful run and a misleading one.
 *
 * When the project pins nothing, the engine is inferred from the binary's own
 * bytecode version and marked `detected` so the two cases are never confused.
 */
export function formatProvisionSummary(
  source: SelectedSource,
  context: EngineContext,
  binary: HermesBinary,
): string {
  let engine: string;
  if (context.ref !== undefined) {
    engine = context.ref.engine;
  } else {
    const detected =
      binary.bytecodeVersion === undefined
        ? undefined
        : engineForBytecodeVersion(binary.bytecodeVersion);
    engine = detected === undefined ? 'unknown engine' : `${detected} (detected)`;
  }

  const version = context.ref?.tag ?? binary.releaseVersion ?? 'unknown version';
  return `✓ hermes ${engine} ${version} · ${describeSource(source)} · ${binary.path}\n`;
}

/**
 * The mismatch warning.
 *
 * A warning, never a failure: running a deliberately mismatched binary is a
 * legitimate thing to do (bisecting an engine bug, testing a patched VM), and
 * refusing would take that away. What is not legitimate is doing it by accident
 * and never being told — hence stderr, and hence naming both engines outright.
 */
export function formatFidelityWarning(fidelity: EngineFidelity, binary: HermesBinary): string {
  if (fidelity.kind !== 'mismatch') return '';

  const actual =
    fidelity.actualEngine === undefined
      ? `bytecode ${fidelity.actualBytecodeVersion} (unrecognised engine)`
      : `${fidelity.actualEngine} (bytecode ${fidelity.actualBytecodeVersion})`;

  return (
    `⚠ Engine mismatch: this project targets ${fidelity.expected} ` +
    `(bytecode ${fidelity.expectedBytecodeVersion}), but the provisioned binary is ${actual}.\n` +
    `    binary: ${binary.path}\n` +
    `    Tests will run on that binary, so results reflect ${
      fidelity.actualEngine ?? 'another engine'
    }, not the engine this project ships.\n` +
    '    Fix: drop --hermes/ARGUS_HERMES to provision the pinned engine, or pass ' +
    `--engine ${fidelity.actualEngine ?? '<engine>'} if this project pins ` +
    `${fidelity.actualEngine ?? 'it'} too.\n`
  );
}

/** Usage error for `--engine X` when the project pins something else entirely. */
export function formatEngineUnavailable(
  requested: HermesEngine,
  available: HermesEngine[],
  rnVersion?: string,
): string {
  const project = rnVersion === undefined ? 'this project' : `react-native ${rnVersion}`;
  const pins = available.length === 0 ? 'no Hermes engine at all' : `only: ${available.join(', ')}`;
  return `--engine ${requested} is not available: ${project} pins ${pins}.`;
}

/**
 * Engine-fidelity domain logic — PURE. No filesystem, no process.
 *
 * Argus exists to run tests on the engine the project actually ships. That
 * promise is only worth something if a mismatch is detectable, and the HBC
 * bytecode version is the one field that distinguishes the two engines
 * reliably: `releaseVersion` depends on how the binary was configured (a plain
 * clone of any tag reports `1.0.0`), whereas the bytecode version is baked into
 * the VM's format support.
 */

import type { HermesEngine, HermesVersionInfo } from './hermes-version.js';

/**
 * HBC bytecode version each engine speaks.
 *
 * A VM refuses foreign bytecode outright — 'Wrong bytecode version. Expected 98
 * but got 96' — so these two numbers are the engine identity at runtime.
 */
export const EXPECTED_BYTECODE_VERSION: Readonly<Record<HermesEngine, number>> = {
  legacy: 96,
  v1: 98,
};

/**
 * Reverse the mapping: which engine emits `bytecodeVersion`.
 *
 * Returns `undefined` for any other number rather than guessing. Future Hermes
 * releases will bump this field, and naming an engine we cannot actually
 * identify would make the fidelity warning lie.
 */
export function engineForBytecodeVersion(bytecodeVersion: number): HermesEngine | undefined {
  for (const engine of Object.keys(EXPECTED_BYTECODE_VERSION) as HermesEngine[]) {
    if (EXPECTED_BYTECODE_VERSION[engine] === bytecodeVersion) return engine;
  }
  return undefined;
}

/**
 * Verdict on whether a provisioned binary is the engine the project targets.
 *
 * `unknown` is a first-class outcome, not a failure: a binary that does not
 * report a bytecode version (older builds, a wrapper script, a binary that
 * cannot be executed to ask) is not evidence of a mismatch, so the caller must
 * stay silent rather than warn on a guess.
 */
export type EngineFidelity =
  | { kind: 'ok'; engine: HermesEngine; bytecodeVersion: number }
  | { kind: 'unknown' }
  | {
      kind: 'mismatch';
      /** Engine the project targets. */
      expected: HermesEngine;
      /** Bytecode version that engine would have reported. */
      expectedBytecodeVersion: number;
      /** Bytecode version the binary actually reported. */
      actualBytecodeVersion: number;
      /** Engine the binary actually is, when the version identifies one. */
      actualEngine?: HermesEngine;
    };

/**
 * Compare a provisioned binary's self-report against the targeted engine.
 *
 * `engine` is optional because a project can pin nothing at all (no React
 * Native install, or an install with no readable pin). With no target there is
 * nothing to be unfaithful to, so the verdict is `unknown`.
 */
export function checkEngineFidelity(
  engine: HermesEngine | undefined,
  info: HermesVersionInfo,
): EngineFidelity {
  const actual = info.bytecodeVersion;
  if (engine === undefined || actual === undefined) return { kind: 'unknown' };

  const expectedBytecodeVersion = EXPECTED_BYTECODE_VERSION[engine];
  if (expectedBytecodeVersion === actual) return { kind: 'ok', engine, bytecodeVersion: actual };

  const actualEngine = engineForBytecodeVersion(actual);
  return {
    kind: 'mismatch',
    expected: engine,
    expectedBytecodeVersion,
    actualBytecodeVersion: actual,
    ...(actualEngine === undefined ? {} : { actualEngine }),
  };
}

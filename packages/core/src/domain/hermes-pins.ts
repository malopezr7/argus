import { type HermesEngine, type PinnedRefs, parseHermesTag } from './hermes-version.js';

/**
 * RN-branch to Hermes mapping — PURE lookup data, used only as a fallback when
 * the user's own React Native install cannot be read. The project's files are
 * authoritative at runtime; this table is the offline safety net.
 *
 * Source of truth: https://reactnative.dev/releases/branches
 *
 * Kept as raw strings (not pre-built `HermesRef`s) so a row stays diffable
 * against the published table, and so refreshing it in CI is a data-only edit.
 * Refs are derived on lookup via `parseHermesTag`, which keeps tag
 * canonicalisation in exactly one place.
 */
interface RawPins {
  legacy?: string;
  v1?: string;
  /**
   * The engine this release SHIPS BY DEFAULT.
   *
   * A separate question from which engines it pins, and the one that decides
   * what Argus runs. RN 0.82 and 0.83 pin both engines yet ship legacy: V1 was
   * an experimental opt-in there, reachable only by building React Native from
   * source with `hermesV1Enabled=true` / `RCT_HERMES_V1_ENABLED=1`. Reading
   * "pins V1" as "runs V1" would test a VM those apps never execute.
   *
   * Must always name an engine the same row pins — `defaultEngineForRn` is
   * trusted to return something selectable, and the test suite asserts it.
   */
  defaultEngine: HermesEngine;
}

export const HERMES_PINS_BY_RN_MINOR: Readonly<Record<string, RawPins>> = {
  '0.87': { v1: 'v250829098.0.16', defaultEngine: 'v1' },
  '0.86': { legacy: 'v0.17.0', v1: 'v250829098.0.16', defaultEngine: 'v1' },
  '0.85': { legacy: 'v0.16.0', v1: 'v250829098.0.10', defaultEngine: 'v1' },
  // Hermes V1 became the default engine in 0.84 ("React Native 0.84 - Hermes
  // V1 by Default"). 0.82 and 0.83 pin it, but only as an opt-in.
  '0.84': { legacy: 'v0.15.1', v1: 'v250829098.0.9', defaultEngine: 'v1' },
  '0.83': { legacy: 'v0.14.1', v1: 'v250829098.0.4', defaultEngine: 'legacy' },
  '0.82': { legacy: '2025-09-01-RNv0.82.0', v1: '76dc3793', defaultEngine: 'legacy' },
  '0.81': { legacy: '2025-07-07-RNv0.81.0', defaultEngine: 'legacy' },
  '0.80': { legacy: '2025-07-24-RNv0.80.2', defaultEngine: 'legacy' },
  '0.79': { legacy: '2025-06-04-RNv0.79.3', defaultEngine: 'legacy' },
  '0.78': { legacy: '2025-01-13-RNv0.78.0', defaultEngine: 'legacy' },
};

/** Matches the `<major>.<minor>` head of an RN version, ignoring patch/prerelease. */
const RN_MINOR_RE = /^(\d+)\.(\d+)(?:$|[.+-])/;

/**
 * Reduce a full RN version to its table key: '0.86.2' -> '0.86'.
 * Returns undefined when the input is not a recognisable version.
 */
export function rnMinor(rnVersion: string): string | undefined {
  const match = RN_MINOR_RE.exec(rnVersion.trim());
  return match === null ? undefined : `${match[1]}.${match[2]}`;
}

/**
 * Look up the Hermes refs an RN release pins.
 *
 * Degrades to an empty result for unknown or unparsable versions — an
 * out-of-table RN is a resolution miss, not an error.
 */
export function lookupPinnedRefs(rnVersion: string): PinnedRefs {
  const minor = rnMinor(rnVersion);
  if (minor === undefined) return {};

  const raw = HERMES_PINS_BY_RN_MINOR[minor];
  if (raw === undefined) return {};

  const pins: PinnedRefs = {};
  // The table's engine column is authoritative, so both columns are parsed with
  // an explicit hint — RN 0.82 pins its V1 engine as a bare commit SHA, which
  // carries no engine signal in its shape.
  const legacy = raw.legacy === undefined ? undefined : parseHermesTag(raw.legacy, 'legacy');
  if (legacy !== undefined) pins.legacy = legacy;

  const v1 = raw.v1 === undefined ? undefined : parseHermesTag(raw.v1, 'v1');
  if (v1 !== undefined) pins.v1 = v1;

  return pins;
}

/**
 * Which Hermes engine a React Native release runs unless told otherwise.
 *
 * This is what makes engine selection honest for 0.82 and 0.83, which pin both
 * engines and ship legacy. Selecting "V1 whenever V1 is pinned" would run those
 * projects' tests on an engine their apps never load — a green suite proving
 * nothing about the binary that actually ships.
 *
 * Returns `undefined` for a version outside the table, which the caller must
 * treat as "unknown", never as a licence to guess quietly.
 */
export function defaultEngineForRn(rnVersion: string): HermesEngine | undefined {
  const minor = rnMinor(rnVersion);
  if (minor === undefined) return undefined;

  return HERMES_PINS_BY_RN_MINOR[minor]?.defaultEngine;
}

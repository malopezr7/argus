/**
 * Which syntax each Hermes engine may be handed — the one place that answers it.
 *
 * Argus exists to run tests on the engine the project ships, so this policy is
 * wrong in two directions, not one. Hand legacy syntax it cannot parse and the
 * whole file dies before a single test runs. Downlevel syntax V1 reads natively
 * and the tests no longer exercise the code the user wrote.
 *
 * Every entry below was probed against the real binaries rather than inferred
 * from release notes:
 *
 *   feature                     legacy (HBC 96)   V1 (HBC 98)
 *   class, any form             rejected          native
 *   class fields / #private     rejected          native
 *   static {}                   rejected          native
 *   extends / super             rejected          native
 *   async function / method     native            native
 *   async ARROW                 rejected          native
 *   async generator             rejected          REJECTED
 *   for await                   rejected          native
 *   WeakRef                     absent            present
 *   let/const, for-of, spread,  native            native
 *     destructuring, optional
 *     chaining, ??, ??=, **,
 *     BigInt, numeric separators
 *
 * Two of those are worth stating out loud because the obvious model gets them
 * wrong: legacy DOES run async functions (only the arrow form is rejected), and
 * V1 is NOT a superset — it rejects async generators exactly as legacy does.
 */

import type { HermesEngine } from '@arguslab/core';

/** The esbuild settings and lowering scope one engine requires. */
export interface HermesSyntaxPolicy {
  /**
   * esbuild `target`. The highest ES level the engine parses whole, so nothing
   * above it survives and nothing below it is rewritten for no reason.
   */
  target: string[];
  /**
   * Per-feature overrides on top of `target`, for syntax whose support does not
   * line up with an ES level.
   */
  supported: Record<string, boolean>;
  /**
   * Whether classes must be lowered by Babel.
   *
   * esbuild cannot do this itself — asking it to lower `class` fails outright
   * with "Transforming class syntax to the configured target environment is not
   * supported yet" — which is why a Babel pass exists at all.
   */
  lowerClasses: boolean;
}

/**
 * ES2020 is the ceiling legacy parses whole: it reads optional chaining,
 * nullish coalescing, `**`, BigInt and destructuring, and everything it rejects
 * is either handled by `supported` below or lowered by Babel.
 */
const LEGACY_TARGET = ['es2020'];

/**
 * ES2022 is what V1 needs to keep private fields and static blocks intact.
 * Going higher would buy nothing V1 can use and would start passing through
 * regexp flags it has no parser for.
 */
const V1_TARGET = ['es2022'];

/**
 * Async generators are rejected by BOTH engines, so this override is shared.
 * esbuild lowers them to a generator + Promise pair that both VMs run.
 */
const ASYNC_GENERATOR_UNSUPPORTED = { 'async-generator': false } as const;

const LEGACY: HermesSyntaxPolicy = {
  target: LEGACY_TARGET,
  supported: {
    ...ASYNC_GENERATOR_UNSUPPORTED,
    /**
     * Legacy runs async FUNCTIONS but rejects async ARROWS, and esbuild has no
     * separate switch for the arrow form — `async-await` is the only lever, so
     * async is lowered wholesale. Downlevelling a little more than strictly
     * necessary is the safe side of this trade: the alternative, `arrow: false`,
     * would rewrite every arrow in the user's code instead.
     */
    'async-await': false,
  },
  lowerClasses: true,
};

const V1: HermesSyntaxPolicy = {
  target: V1_TARGET,
  supported: { ...ASYNC_GENERATOR_UNSUPPORTED },
  lowerClasses: false,
};

/**
 * The syntax policy for `engine`.
 *
 * An unknown engine gets the legacy envelope. That asymmetry is deliberate:
 * lowered code runs on both engines, un-lowered code runs on one, so with no
 * evidence about which VM will parse the bundle there is exactly one answer
 * that cannot produce an unrunnable file.
 */
export function hermesSyntaxPolicy(engine: HermesEngine | undefined): HermesSyntaxPolicy {
  return engine === 'v1' ? V1 : LEGACY;
}

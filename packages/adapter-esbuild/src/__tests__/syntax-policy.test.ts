import { describe, expect, it } from 'vitest';
import { hermesSyntaxPolicy } from '../syntax-policy.js';

/**
 * The policy is the single place that answers "what may this engine parse?".
 * Both halves matter: too permissive and legacy gets syntax it cannot read,
 * too strict and V1 runs downlevelled code that is no longer the code the user
 * wrote — which is the fidelity Argus exists to provide.
 *
 * Every claim below was checked against the real binaries; see
 * `docs`-free note in syntax-policy.ts for the probe results.
 */
describe('hermesSyntaxPolicy', () => {
  it('lowers classes for legacy, which cannot parse `class` in any form', () => {
    expect(hermesSyntaxPolicy('legacy').lowerClasses).toBe(true);
  });

  it('leaves classes alone for V1, which parses every class form natively', () => {
    expect(hermesSyntaxPolicy('v1').lowerClasses).toBe(false);
  });

  it('keeps V1 at a target that preserves private fields and static blocks', () => {
    // Both are ES2022. A lower target would make esbuild rewrite them even
    // though V1 reads them natively.
    expect(hermesSyntaxPolicy('v1').target).toEqual(['es2022']);
  });

  it('holds legacy at es2020, the highest level it parses whole', () => {
    expect(hermesSyntaxPolicy('legacy').target).toEqual(['es2020']);
  });

  it('lowers async for legacy, whose parser rejects async arrow functions', () => {
    expect(hermesSyntaxPolicy('legacy').supported['async-await']).toBe(false);
  });

  it('leaves async alone for V1, which runs async arrows natively', () => {
    expect(hermesSyntaxPolicy('v1').supported['async-await']).toBeUndefined();
  });

  it('lowers async generators for BOTH engines — V1 rejects them too', () => {
    // Probed: `async function* g(){}` fails on bytecode 96 AND 98 with
    // "async generators are unsupported". V1 is not a superset here.
    expect(hermesSyntaxPolicy('legacy').supported['async-generator']).toBe(false);
    expect(hermesSyntaxPolicy('v1').supported['async-generator']).toBe(false);
  });

  it('falls back to the legacy envelope when the engine is unknown', () => {
    // Lowered code runs on both engines; unlowered code runs on one. An
    // unidentified binary therefore has exactly one safe answer.
    expect(hermesSyntaxPolicy(undefined)).toEqual(hermesSyntaxPolicy('legacy'));
  });
});

import { describe, expect, it } from 'vitest';
import {
  defaultEngineForRn,
  HERMES_PINS_BY_RN_MINOR,
  lookupPinnedRefs,
  rnMinor,
} from '../domain/hermes-pins.js';

describe('rnMinor', () => {
  it.each([
    ['0.86', '0.86'],
    ['0.86.0', '0.86'],
    ['0.86.2', '0.86'],
    ['0.86.0-rc.1', '0.86'],
    ['0.86.0-nightly-20260101', '0.86'],
    ['  0.86.2  ', '0.86'],
    ['1.0.0', '1.0'],
  ])('reduces %s to %s', (input, expected) => {
    expect(rnMinor(input)).toBe(expected);
  });

  it.each(['', 'next', 'v', '0', 'latest'])('returns undefined for %j', (input) => {
    expect(rnMinor(input)).toBeUndefined();
  });
});

describe('lookupPinnedRefs', () => {
  // Mirrors https://reactnative.dev/releases/branches — one case per published row.
  const rows = [
    { rn: '0.87', legacy: undefined, v1: '250829098.0.16' },
    { rn: '0.86', legacy: '0.17.0', v1: '250829098.0.16' },
    { rn: '0.85', legacy: '0.16.0', v1: '250829098.0.10' },
    { rn: '0.84', legacy: '0.15.1', v1: '250829098.0.9' },
    { rn: '0.83', legacy: '0.14.1', v1: '250829098.0.4' },
    { rn: '0.82', legacy: '2025-09-01-RNv0.82.0', v1: '76dc3793' },
    { rn: '0.81', legacy: '2025-07-07-RNv0.81.0', v1: undefined },
    { rn: '0.80', legacy: '2025-07-24-RNv0.80.2', v1: undefined },
    { rn: '0.79', legacy: '2025-06-04-RNv0.79.3', v1: undefined },
    { rn: '0.78', legacy: '2025-01-13-RNv0.78.0', v1: undefined },
  ] as const;

  it.each(rows)('maps RN $rn to its published pins', ({ rn, legacy, v1 }) => {
    const pins = lookupPinnedRefs(rn);
    expect(pins.legacy?.version).toBe(legacy);
    expect(pins.v1?.version).toBe(v1);
  });

  it.each(rows)('tags RN $rn pins with the right engine', ({ rn, legacy, v1 }) => {
    const pins = lookupPinnedRefs(rn);
    if (legacy !== undefined) expect(pins.legacy?.engine).toBe('legacy');
    if (v1 !== undefined) expect(pins.v1?.engine).toBe('v1');
  });

  it('drops legacy for RN 0.87, which ships V1 only', () => {
    const pins = lookupPinnedRefs('0.87');
    expect(pins.legacy).toBeUndefined();
    expect(pins.v1).toBeDefined();
  });

  it('drops v1 for RN 0.81 and below, which predate Hermes V1', () => {
    for (const rn of ['0.81', '0.80', '0.79', '0.78']) {
      expect(lookupPinnedRefs(rn).v1).toBeUndefined();
    }
  });

  it("classifies RN 0.82's commit-sha V1 pin as v1 despite its shape", () => {
    // A bare sha carries no engine signal; the table column is authoritative.
    expect(lookupPinnedRefs('0.82').v1).toEqual({
      engine: 'v1',
      tag: '76dc3793',
      version: '76dc3793',
    });
  });

  it('resolves a full patch version to its minor row', () => {
    expect(lookupPinnedRefs('0.86.2')).toEqual(lookupPinnedRefs('0.86'));
    expect(lookupPinnedRefs('0.86.2').v1?.tag).toBe('hermes-v250829098.0.16');
  });

  it('resolves a prerelease version to its minor row', () => {
    expect(lookupPinnedRefs('0.85.0-rc.3')).toEqual(lookupPinnedRefs('0.85'));
  });

  it.each(['0.99.0', '0.77.0', '2.0.0', 'next', ''])(
    'degrades to an empty result for unknown version %j',
    (rn) => {
      expect(lookupPinnedRefs(rn)).toEqual({});
    },
  );

  it('produces canonical git tags for every table row', () => {
    for (const rn of Object.keys(HERMES_PINS_BY_RN_MINOR)) {
      const pins = lookupPinnedRefs(rn);
      for (const ref of [pins.legacy, pins.v1]) {
        if (ref === undefined) continue;
        expect(ref.tag.length).toBeGreaterThan(0);
        expect(ref.version.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers every published RN row and nothing else', () => {
    expect(Object.keys(HERMES_PINS_BY_RN_MINOR).sort()).toEqual(
      rows.map((r) => r.rn as string).sort(),
    );
  });
});

describe('defaultEngineForRn', () => {
  /**
   * Which engine each release SHIPS BY DEFAULT — a different question from
   * which engines it pins, and the one that decides what Argus must run.
   *
   * 0.82 and 0.83 pin both engines yet ship legacy: V1 was an experimental
   * opt-in there, reachable only by building React Native from source with
   * `hermesV1Enabled=true` / `RCT_HERMES_V1_ENABLED=1`. Verified against the
   * release posts:
   *   0.82 — "ships with an experimental opt-in to a newer version of Hermes"
   *   0.83 — "While Hermes V1 is in the experimental phase, you'll need to
   *           build React Native from source to try it out"
   *   0.84 — "React Native 0.84 - Hermes V1 by Default"
   */
  it.each([
    ['0.78', 'legacy'],
    ['0.79', 'legacy'],
    ['0.80', 'legacy'],
    ['0.81', 'legacy'],
    ['0.82', 'legacy'],
    ['0.83', 'legacy'],
    ['0.84', 'v1'],
    ['0.85', 'v1'],
    ['0.86', 'v1'],
    ['0.87', 'v1'],
  ])('RN %s ships %s by default', (rn, engine) => {
    expect(defaultEngineForRn(rn)).toBe(engine);
  });

  it('resolves a patch version to its minor row', () => {
    expect(defaultEngineForRn('0.83.4')).toBe('legacy');
    expect(defaultEngineForRn('0.84.1')).toBe('v1');
  });

  it('resolves a prerelease version to its minor row', () => {
    expect(defaultEngineForRn('0.83.0-rc.2')).toBe('legacy');
    expect(defaultEngineForRn('0.84.0-nightly-20260101')).toBe('v1');
  });

  it.each(['0.99.0', '0.77.0', '2.0.0', 'next', ''])(
    'returns undefined for unknown version %j',
    (rn) => {
      expect(defaultEngineForRn(rn)).toBeUndefined();
    },
  );

  /**
   * A row that names a default it does not pin would resolve to nothing and
   * fall through to the other engine — silently, which is the failure the
   * default column exists to prevent.
   */
  it('never names a default engine the same row does not pin', () => {
    for (const rn of Object.keys(HERMES_PINS_BY_RN_MINOR)) {
      const engine = defaultEngineForRn(rn);
      expect(engine).toBeDefined();
      const pins = lookupPinnedRefs(rn);
      expect(engine === 'v1' ? pins.v1 : pins.legacy).toBeDefined();
    }
  });
});

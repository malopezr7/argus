import { describe, expect, it } from 'vitest';
import type { HermesRef, PinnedRefs } from '../domain/hermes-version.js';
import {
  parseHermesTag,
  parseVersionProperties,
  selectHermesEngine,
} from '../domain/hermes-version.js';

describe('parseHermesTag', () => {
  describe('Hermes V1 tags', () => {
    it.each([
      ['hermes-v250829098.0.16', '250829098.0.16'],
      ['hermes-v250829098.0.10', '250829098.0.10'],
      ['hermes-v250829098.0.9', '250829098.0.9'],
      ['hermes-v250829098.0.4', '250829098.0.4'],
      ['hermes-v260318099.0.1', '260318099.0.1'],
    ])('classifies %s as v1', (raw, version) => {
      expect(parseHermesTag(raw)).toEqual({
        engine: 'v1',
        tag: `hermes-v${version}`,
        version,
      });
    });

    it('classifies a bare V1 version with no tag decoration', () => {
      expect(parseHermesTag('250829098.0.16')).toEqual({
        engine: 'v1',
        tag: 'hermes-v250829098.0.16',
        version: '250829098.0.16',
      });
    });
  });

  describe('legacy semver tags', () => {
    it.each([
      ['hermes-v0.17.0', '0.17.0'],
      ['hermes-v0.16.0', '0.16.0'],
      ['hermes-v0.15.1', '0.15.1'],
      ['hermes-v0.14.1', '0.14.1'],
    ])('classifies %s as legacy', (raw, version) => {
      expect(parseHermesTag(raw)).toEqual({ engine: 'legacy', tag: `hermes-v${version}`, version });
    });

    it('treats a single-digit major as legacy (a raw clone reports 1.0.0)', () => {
      expect(parseHermesTag('1.0.0')?.engine).toBe('legacy');
    });
  });

  describe('date-based tags', () => {
    it.each([
      'hermes-2025-09-01-RNv0.82.0',
      'hermes-2025-07-07-RNv0.81.0',
      'hermes-2025-07-24-RNv0.80.2',
      'hermes-2025-06-04-RNv0.79.3',
      'hermes-2025-01-13-RNv0.78.0',
    ])('classifies %s as legacy', (raw) => {
      const parsed = parseHermesTag(raw);
      expect(parsed?.engine).toBe('legacy');
      expect(parsed?.tag).toBe(raw);
      expect(parsed?.version).toBe(raw.slice('hermes-'.length));
    });

    it('parses a date tag carrying a trailing commit sha', () => {
      const raw = 'hermes-2025-07-24-RNv0.80.2-5c7dbc0a78cb2d2a8bc81c41c617c3abecf209ff';
      expect(parseHermesTag(raw)).toEqual({
        engine: 'legacy',
        tag: raw,
        version: '2025-07-24-RNv0.80.2-5c7dbc0a78cb2d2a8bc81c41c617c3abecf209ff',
      });
    });
  });

  describe('prefix handling', () => {
    it('accepts a tag with or without the hermes- prefix', () => {
      const withPrefix = parseHermesTag('hermes-v0.17.0');
      const withoutPrefix = parseHermesTag('v0.17.0');
      const bare = parseHermesTag('0.17.0');
      expect(withoutPrefix).toEqual(withPrefix);
      expect(bare).toEqual(withPrefix);
    });

    it('canonicalises a date-based body to a prefixed tag', () => {
      expect(parseHermesTag('2025-09-01-RNv0.82.0')?.tag).toBe('hermes-2025-09-01-RNv0.82.0');
    });
  });

  describe('whitespace tolerance', () => {
    it.each([
      '  hermes-v0.17.0  ',
      '\thermes-v0.17.0\n',
      'hermes-v0.17.0\r\n',
      '\n0.17.0\n',
    ])('trims %j', (raw) => {
      expect(parseHermesTag(raw)?.version).toBe('0.17.0');
    });
  });

  describe('commit-sha pins', () => {
    it('accepts a bare commit sha and leaves it undecorated', () => {
      // RN 0.82 pins its V1 engine as a commit, not a tag.
      expect(parseHermesTag('76dc3793')).toEqual({
        engine: 'legacy',
        tag: '76dc3793',
        version: '76dc3793',
      });
    });

    it('does not synthesize a tag name around a prefixed sha', () => {
      expect(parseHermesTag('hermes-76dc3793')?.tag).toBe('hermes-76dc3793');
    });
  });

  describe('engine hint', () => {
    it('lets authoritative provenance classify a sha that shape cannot', () => {
      expect(parseHermesTag('76dc3793', 'v1')).toEqual({
        engine: 'v1',
        tag: '76dc3793',
        version: '76dc3793',
      });
    });

    it('overrides shape inference for semver input', () => {
      expect(parseHermesTag('0.17.0', 'v1')?.engine).toBe('v1');
      expect(parseHermesTag('250829098.0.16', 'legacy')?.engine).toBe('legacy');
    });

    it('does not rescue input that matches no scheme', () => {
      expect(parseHermesTag('not-a-version', 'v1')).toBeUndefined();
    });
  });

  describe('garbage input', () => {
    it.each([
      ['empty', ''],
      ['whitespace only', '   \n\t '],
      ['prefix only', 'hermes-'],
      ['prose', 'not-a-version'],
      ['two-part version', 'v1.2'],
      ['truncated semver', '0.17'],
      ['too short for a sha', 'facade'],
      ['non-hex word', 'unstable'],
      ['malformed date', '2025-7-24'],
    ])('returns undefined for %s', (_label, raw) => {
      expect(parseHermesTag(raw)).toBeUndefined();
    });

    it('does not throw on garbage', () => {
      expect(() => parseHermesTag('\u0000\uFFFD')).not.toThrow();
    });
  });
});

describe('parseVersionProperties', () => {
  it('reads both engines from a normal RN 0.86 file', () => {
    const contents = 'HERMES_VERSION_NAME=0.17.0\nHERMES_V1_VERSION_NAME=250829098.0.16\n';
    expect(parseVersionProperties(contents)).toEqual({
      legacy: '0.17.0',
      v1: '250829098.0.16',
    });
  });

  it('ignores # and ! comments and blank lines', () => {
    const contents = [
      '# Hermes engine versions',
      '',
      '! legacy engine',
      'HERMES_VERSION_NAME=0.17.0',
      '',
      '#HERMES_V1_VERSION_NAME=999.0.0',
      'HERMES_V1_VERSION_NAME=250829098.0.16',
      '',
    ].join('\n');
    expect(parseVersionProperties(contents)).toEqual({
      legacy: '0.17.0',
      v1: '250829098.0.16',
    });
  });

  it('handles CRLF line endings', () => {
    const contents = 'HERMES_VERSION_NAME=0.17.0\r\nHERMES_V1_VERSION_NAME=250829098.0.16\r\n';
    expect(parseVersionProperties(contents)).toEqual({
      legacy: '0.17.0',
      v1: '250829098.0.16',
    });
  });

  it('tolerates whitespace around the separator', () => {
    const contents =
      '  HERMES_VERSION_NAME   =   0.17.0  \n\tHERMES_V1_VERSION_NAME\t=\t250829098.0.16\t';
    expect(parseVersionProperties(contents)).toEqual({
      legacy: '0.17.0',
      v1: '250829098.0.16',
    });
  });

  it('returns only the keys that are present', () => {
    expect(parseVersionProperties('HERMES_V1_VERSION_NAME=250829098.0.16')).toEqual({
      v1: '250829098.0.16',
    });
    expect(parseVersionProperties('HERMES_VERSION_NAME=0.17.0')).toEqual({ legacy: '0.17.0' });
  });

  it('returns an empty result when no known key is present', () => {
    expect(parseVersionProperties('')).toEqual({});
    expect(parseVersionProperties('SOME_OTHER_KEY=1\n# comment\n')).toEqual({});
    expect(parseVersionProperties('a line with no separator')).toEqual({});
  });

  it('treats an empty value as absent', () => {
    expect(parseVersionProperties('HERMES_VERSION_NAME=\nHERMES_V1_VERSION_NAME=   ')).toEqual({});
  });

  it('does not confuse the legacy key with the V1 key', () => {
    // HERMES_VERSION_NAME is a prefix-free distinct key; a naive includes()
    // check would match HERMES_V1_VERSION_NAME too.
    expect(parseVersionProperties('HERMES_V1_VERSION_NAME=250829098.0.16').legacy).toBeUndefined();
  });
});

describe('selectHermesEngine', () => {
  const legacy: HermesRef = { engine: 'legacy', tag: 'hermes-v0.17.0', version: '0.17.0' };
  const v1: HermesRef = {
    engine: 'v1',
    tag: 'hermes-v250829098.0.16',
    version: '250829098.0.16',
  };
  const both: PinnedRefs = { legacy, v1 };

  describe('default policy', () => {
    it('prefers v1 when both are pinned', () => {
      expect(selectHermesEngine(both)).toEqual({ kind: 'selected', ref: v1 });
    });

    it('falls back to legacy when only legacy is pinned', () => {
      expect(selectHermesEngine({ legacy })).toEqual({ kind: 'selected', ref: legacy });
    });

    it('selects v1 when only v1 is pinned', () => {
      expect(selectHermesEngine({ v1 })).toEqual({ kind: 'selected', ref: v1 });
    });

    it('reports none when nothing is pinned', () => {
      expect(selectHermesEngine({})).toEqual({ kind: 'none' });
    });
  });

  describe('explicit preference', () => {
    it('honours an explicit legacy request over the v1 default', () => {
      expect(selectHermesEngine(both, 'legacy')).toEqual({ kind: 'selected', ref: legacy });
    });

    it('honours an explicit v1 request', () => {
      expect(selectHermesEngine(both, 'v1')).toEqual({ kind: 'selected', ref: v1 });
    });
  });

  describe('requested engine is not pinned', () => {
    it('reports unavailable rather than silently returning the other engine', () => {
      expect(selectHermesEngine({ legacy }, 'v1')).toEqual({
        kind: 'unavailable',
        requested: 'v1',
        available: ['legacy'],
      });
    });

    it('reports unavailable when legacy is requested on a v1-only project', () => {
      expect(selectHermesEngine({ v1 }, 'legacy')).toEqual({
        kind: 'unavailable',
        requested: 'legacy',
        available: ['v1'],
      });
    });

    it('reports an empty available list when nothing is pinned at all', () => {
      expect(selectHermesEngine({}, 'v1')).toEqual({
        kind: 'unavailable',
        requested: 'v1',
        available: [],
      });
    });
  });
});

import { describe, expect, it } from 'vitest';
import { ConfigError, validateConfig } from '../config/validate.js';

const SOURCE = '/repo/argus.config.ts';

/** Runs the validator and returns the message, failing loudly if it accepted. */
function rejectionMessage(value: unknown): string {
  try {
    validateConfig(value, SOURCE);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error('expected validateConfig to reject, but it accepted the value');
}

describe('validateConfig — accepted shapes', () => {
  it('accepts an empty object', () => {
    expect(validateConfig({}, SOURCE)).toEqual({});
  });

  it('accepts every option at once', () => {
    const config = {
      include: ['src/**/*.test.ts'],
      exclude: ['**/fixtures/**'],
      root: 'packages/app',
      timeout: 30_000,
      concurrency: 4,
      hermes: { path: '/opt/hermes', engine: 'v1', provision: true },
    };

    expect(validateConfig(config, SOURCE)).toEqual(config);
  });

  it('accepts empty arrays, which mean "match nothing" and "exclude nothing"', () => {
    expect(validateConfig({ include: [], exclude: [] }, SOURCE)).toEqual({
      include: [],
      exclude: [],
    });
  });

  /**
   * `{ timeout: undefined }` is what spreading an absent optional produces, so
   * it has to mean "not set" rather than "set to nothing".
   */
  it('treats an explicit undefined as absent', () => {
    expect(validateConfig({ timeout: undefined, hermes: undefined }, SOURCE)).toEqual({});
  });

  it('accepts both engine names', () => {
    expect(validateConfig({ hermes: { engine: 'legacy' } }, SOURCE)).toEqual({
      hermes: { engine: 'legacy' },
    });
  });
});

describe('validateConfig — the top level', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'timeout=5'],
    ['a number', 5],
  ])('rejects %s', (_label, value) => {
    expect(rejectionMessage(value)).toContain('must export an object');
  });

  it('names the file it rejected', () => {
    expect(rejectionMessage(null)).toContain(SOURCE);
  });

  /**
   * A misspelled key that silently does nothing is the exact failure this
   * layer exists to prevent — the user sees a green run governed by settings
   * they believe they changed.
   */
  it('rejects an unknown key and lists the ones it accepts', () => {
    const message = rejectionMessage({ timout: 5_000 });

    expect(message).toContain('"timout"');
    expect(message).toContain('not a known option');
    expect(message).toContain('include');
  });

  it('rejects an unknown key inside hermes', () => {
    expect(rejectionMessage({ hermes: { binary: '/opt/hermes' } })).toContain('"hermes.binary"');
  });

  it('reports every problem at once rather than one per run', () => {
    const message = rejectionMessage({ timeout: 'soon', concurrency: 0 });

    expect(message).toContain('"timeout"');
    expect(message).toContain('"concurrency"');
  });
});

describe('validateConfig — per-option rules', () => {
  it.each([
    ['include', 'src/**/*.test.ts'],
    ['exclude', '**/fixtures/**'],
  ])('rejects a bare string for %s and says an array is expected', (key, value) => {
    const message = rejectionMessage({ [key]: value });

    expect(message).toContain(`"${key}"`);
    expect(message).toContain('array of strings');
    expect(message).toContain(JSON.stringify(value));
  });

  it('rejects a non-string entry inside include, naming its index', () => {
    const message = rejectionMessage({ include: ['ok', 42] });

    expect(message).toContain('"include[1]"');
    expect(message).toContain('42');
  });

  it('rejects an empty string entry, which would match nothing silently', () => {
    expect(rejectionMessage({ include: [''] })).toContain('"include[0]"');
  });

  it.each([
    ['a string', 'soon'],
    ['zero', 0],
    ['a negative', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
  ])('rejects %s for timeout', (_label, value) => {
    const message = rejectionMessage({ timeout: value });

    expect(message).toContain('"timeout"');
    expect(message).toContain('positive integer');
  });

  it('reports the received value and its type for timeout', () => {
    const message = rejectionMessage({ timeout: 'soon' });

    expect(message).toContain('"soon"');
    expect(message).toContain('string');
  });

  it.each([
    ['a string', '4'],
    ['zero', 0],
    ['a negative', -2],
    ['a fraction', 2.5],
  ])('rejects %s for concurrency', (_label, value) => {
    const message = rejectionMessage({ concurrency: value });

    expect(message).toContain('"concurrency"');
    expect(message).toContain('positive integer');
  });

  it('rejects a non-string root', () => {
    expect(rejectionMessage({ root: 42 })).toContain('"root"');
  });

  it('rejects an empty root', () => {
    expect(rejectionMessage({ root: '' })).toContain('"root"');
  });

  it('rejects a non-object hermes', () => {
    expect(rejectionMessage({ hermes: '/opt/hermes' })).toContain('"hermes"');
  });

  it('rejects an unknown engine and lists the ones that exist', () => {
    const message = rejectionMessage({ hermes: { engine: 'hermes2' } });

    expect(message).toContain('"hermes.engine"');
    expect(message).toContain('legacy');
    expect(message).toContain('v1');
  });

  it('rejects a non-boolean provision', () => {
    const message = rejectionMessage({ hermes: { provision: 'yes' } });

    expect(message).toContain('"hermes.provision"');
    expect(message).toContain('boolean');
  });

  it('rejects a non-string hermes.path', () => {
    expect(rejectionMessage({ hermes: { path: 42 } })).toContain('"hermes.path"');
  });
});

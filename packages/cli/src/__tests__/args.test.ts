import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CONCURRENCY,
  ENGINE_VALUES,
  parseCliArgs,
  USAGE,
  UsageError,
} from '../args.js';

describe('usage', () => {
  it('documents both default test extensions', () => {
    expect(USAGE).toContain('**/*.test.ts');
    expect(USAGE).toContain('**/*.test.tsx');
  });
});

describe('parseCliArgs — --concurrency / -c', () => {
  it('-c 3 → concurrency === 3', () => {
    expect(parseCliArgs(['-c', '3', 'some.test.ts']).concurrency).toBe(3);
  });

  it('--concurrency 4 → concurrency === 4', () => {
    expect(parseCliArgs(['--concurrency', '4']).concurrency).toBe(4);
  });

  it('-c 1 → concurrency === 1', () => {
    expect(parseCliArgs(['-c', '1']).concurrency).toBe(1);
  });

  it('default (no flag) → concurrency >= 1', () => {
    const { concurrency } = parseCliArgs([]);
    expect(concurrency).toBeGreaterThanOrEqual(1);
  });

  it('default (no flag) → concurrency === clamp(availableParallelism(), 1, DEFAULT_MAX_CONCURRENCY)', () => {
    const expected = Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism()));
    expect(parseCliArgs([]).concurrency).toBe(expected);
  });

  // Strict validation — UsageError cases (task 2.1b / 2.2b)

  it('-c 1.5 throws UsageError', () => {
    expect(() => parseCliArgs(['-c', '1.5'])).toThrow(UsageError);
  });

  it('-c 2abc throws UsageError', () => {
    expect(() => parseCliArgs(['-c', '2abc'])).toThrow(UsageError);
  });

  it('-c 1e2 throws UsageError', () => {
    expect(() => parseCliArgs(['-c', '1e2'])).toThrow(UsageError);
  });

  it('-c 0 throws UsageError', () => {
    expect(() => parseCliArgs(['-c', '0'])).toThrow(UsageError);
  });

  it('-c -1 throws UsageError', () => {
    // parseArgs may interpret -1 as a flag; test via --concurrency
    expect(() => parseCliArgs(['--concurrency', '-1'])).toThrow(UsageError);
  });

  it('UsageError message is descriptive', () => {
    try {
      parseCliArgs(['-c', '0']);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).message).toMatch(/concurrency/i);
    }
  });
});

describe('parseCliArgs — other options unaffected', () => {
  it('positionals become patterns', () => {
    expect(parseCliArgs(['foo/**/*.test.ts']).patterns).toEqual(['foo/**/*.test.ts']);
  });

  it('-t 5000 sets timeoutMs', () => {
    expect(parseCliArgs(['-t', '5000']).timeoutMs).toBe(5000);
  });

  it('--help sets help flag', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
  });
});

describe('parseCliArgs — --engine', () => {
  it('--engine legacy is accepted', () => {
    expect(parseCliArgs(['--engine', 'legacy']).engine).toBe('legacy');
  });

  it('--engine v1 is accepted', () => {
    expect(parseCliArgs(['--engine', 'v1']).engine).toBe('v1');
  });

  it('is absent by default, leaving the project to decide', () => {
    expect(parseCliArgs([]).engine).toBeUndefined();
  });

  it('rejects an unknown engine rather than silently ignoring it', () => {
    expect(() => parseCliArgs(['--engine', 'hermes'])).toThrow(UsageError);
    expect(() => parseCliArgs(['--engine', ''])).toThrow(UsageError);
  });

  it('rejects a near-miss spelling', () => {
    expect(() => parseCliArgs(['--engine', 'V1'])).toThrow(UsageError);
    expect(() => parseCliArgs(['--engine', 'static-hermes'])).toThrow(UsageError);
  });

  it('names the accepted values in the error', () => {
    try {
      parseCliArgs(['--engine', 'nope']);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).message).toContain('legacy');
      expect((e as UsageError).message).toContain('v1');
    }
  });

  it('lists exactly the two engines it accepts', () => {
    expect(ENGINE_VALUES).toEqual(['legacy', 'v1']);
  });
});

describe('parseCliArgs — --provision', () => {
  it('defaults to false so a source build is never silent', () => {
    expect(parseCliArgs([]).provision).toBe(false);
  });

  it('--provision sets the flag', () => {
    expect(parseCliArgs(['--provision']).provision).toBe(true);
  });

  it('combines with globs and other options', () => {
    const args = parseCliArgs(['--provision', '--engine', 'v1', '-c', '2', 'a.test.ts']);

    expect(args.provision).toBe(true);
    expect(args.engine).toBe('v1');
    expect(args.concurrency).toBe(2);
    expect(args.patterns).toEqual(['a.test.ts']);
  });
});

describe('usage documents the provisioning surface', () => {
  it('mentions --engine and --provision', () => {
    expect(USAGE).toContain('--engine');
    expect(USAGE).toContain('--provision');
  });

  it('describes the chain order', () => {
    expect(USAGE).toContain('ARGUS_HERMES');
    expect(USAGE).toContain('~/.argus/cache');
  });
});

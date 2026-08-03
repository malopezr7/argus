import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CONCURRENCY,
  defaultConcurrency,
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

  /**
   * Absence is left absent rather than filled in with the default. A parser
   * that returns the default is indistinguishable from a user who typed it,
   * which would make the flag beat the config file on every run. `mergeConfig`
   * applies the default once, after precedence has been decided.
   */
  it('default (no flag) → concurrency is left undefined for the merge to fill', () => {
    expect(parseCliArgs([]).concurrency).toBeUndefined();
  });

  it('the default it is filled with is clamp(availableParallelism(), 1, DEFAULT_MAX_CONCURRENCY)', () => {
    const expected = Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism()));
    expect(defaultConcurrency()).toBe(expected);
    expect(defaultConcurrency()).toBeGreaterThanOrEqual(1);
  });

  // Strict validation — UsageError cases

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

  it('leaves timeoutMs undefined when the flag is absent', () => {
    expect(parseCliArgs([]).timeoutMs).toBeUndefined();
  });

  /**
   * `--timeout abc` used to be silently replaced by the 10 000 ms default, so a
   * typo produced a full green run under a timeout the user never chose and was
   * never told about. It now fails the same way `--concurrency` always has.
   */
  it.each(['abc', '0', '-1', '1.5', '1e3', '5000ms', ' 5000'])(
    '-t %s throws UsageError instead of silently defaulting',
    (raw) => {
      expect(() => parseCliArgs(['-t', raw])).toThrow(UsageError);
    },
  );

  it('names the flag and the bad value when rejecting a timeout', () => {
    try {
      parseCliArgs(['--timeout', 'soon']);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as UsageError).message).toContain('--timeout');
      expect((e as UsageError).message).toContain('"soon"');
    }
  });

  it('--config records the path', () => {
    expect(parseCliArgs(['--config', 'custom.ts']).config).toBe('custom.ts');
  });

  it('leaves config undefined when the flag is absent', () => {
    expect(parseCliArgs([]).config).toBeUndefined();
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
  /**
   * Absent rather than `false`, so a `hermes.provision: true` in the config
   * is not overwritten by a flag the user never passed. `mergeConfig` resolves
   * the absence to `false` when nothing else supplies a value.
   */
  it('is left absent when the flag is not passed', () => {
    expect(parseCliArgs([]).provision).toBeUndefined();
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

describe('parseCliArgs — --version', () => {
  it('--version sets the version flag', () => {
    expect(parseCliArgs(['--version']).version).toBe(true);
  });

  it('is false when the flag is absent', () => {
    expect(parseCliArgs([]).version).toBe(false);
  });

  it('does not consume a value', () => {
    expect(parseCliArgs(['--version', 'a.test.ts']).patterns).toEqual(['a.test.ts']);
  });

  it('is documented in the usage text', () => {
    expect(USAGE).toContain('--version');
  });
});

/**
 * A mistyped flag is a USAGE error, not an infrastructure failure.
 *
 * `node:util.parseArgs` throws a bare `TypeError` for every malformed argument.
 * Only two of those cases were ever converted, and the conversion was decided
 * by searching Node's message text for a flag name — so every other case
 * escaped to the process-level catch and was reported under the same banner
 * Argus uses when the Hermes binary is missing or the VM crashes. Severity is
 * the whole point of that banner; spending it on a typo devalues it everywhere.
 *
 * The class is now taken from `error.code`, which is Node's documented API,
 * and the offending token is found by scanning argv against Argus's own option
 * table — so neither the classification nor the message depends on Node's
 * wording staying still.
 */
describe('parseCliArgs — malformed arguments are usage errors', () => {
  it.each([
    ['--nope'],
    ['--Timeout'],
    ['-x'],
    ['--engine=v1', '--bogus'],
    ['a.test.ts', '--unknown-flag'],
  ])('rejects unknown option %s as a UsageError', (...argv) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
  });

  it.each([
    ['--timeout'],
    ['-t'],
    ['--concurrency'],
    ['-c'],
    ['--engine'],
    ['--config'],
    ['--hermes'],
  ])('rejects %s with no value as a UsageError', (...argv) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
  });

  it.each([['--provision=yes'], ['--help=1'], ['--version=2']])(
    'rejects %s giving a value to a boolean flag as a UsageError',
    (...argv) => {
      expect(() => parseCliArgs(argv)).toThrow(UsageError);
    },
  );

  it('never lets a raw TypeError escape for any malformed argument', () => {
    const malformed = [
      ['--nope'],
      ['-x'],
      ['--timeout'],
      ['--provision=yes'],
      ['--concurrency', '-1'],
      ['-c'],
      ['--engine'],
    ];

    for (const argv of malformed) {
      expect(() => parseCliArgs(argv), argv.join(' ')).toThrow(UsageError);
    }
  });

  it('names the option it did not recognise', () => {
    try {
      parseCliArgs(['--porcelain']);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).message).toContain('--porcelain');
    }
  });

  it('names the option that was missing its value', () => {
    try {
      parseCliArgs(['--engine']);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as UsageError).message).toContain('--engine');
    }
  });

  it('names the boolean flag that was handed a value', () => {
    try {
      parseCliArgs(['--provision=yes']);
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as UsageError).message).toContain('--provision');
    }
  });

  /**
   * The one case that was already converted, kept as a regression: it is now
   * reached through the error CODE and an argv scan rather than by searching
   * Node's message for the literal string "--concurrency".
   */
  it('still explains that --concurrency wants a positive integer', () => {
    try {
      parseCliArgs(['--concurrency', '-1']);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).message).toContain('--concurrency');
      expect((e as UsageError).message).toMatch(/positive integer/i);
    }
  });

  it('applies the same treatment to --timeout', () => {
    try {
      parseCliArgs(['--timeout', '-5']);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).message).toContain('--timeout');
      expect((e as UsageError).message).toMatch(/positive integer/i);
    }
  });

  /**
   * A glob is a positional and may legitimately start with a dash after `--`.
   * Rejecting those would break `argus -- --weird-name.test.ts`.
   */
  it('leaves everything after -- alone', () => {
    expect(parseCliArgs(['--', '--not-a-flag.test.ts']).patterns).toEqual(['--not-a-flag.test.ts']);
  });

  it('accepts a well-formed command line unchanged', () => {
    const args = parseCliArgs(['--engine=v1', '-c', '2', '--provision', 'a.test.ts']);

    expect(args.engine).toBe('v1');
    expect(args.concurrency).toBe(2);
    expect(args.provision).toBe(true);
    expect(args.patterns).toEqual(['a.test.ts']);
  });
});

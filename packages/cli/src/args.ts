import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import type { HermesEngine } from '@arguslab/core';
import { DEFAULT_CONCURRENCY_CAP, ENGINE_VALUES } from '@arguslab/core';

export const USAGE = `argus — run React Native tests on the standalone Hermes engine

Usage:
  argus [globs...]           Discover and run test files (defaults: **/*.test.ts, **/*.test.tsx)

Options:
  -t, --timeout <ms>         Per-file Hermes timeout in ms (default: 10000)
  -c, --concurrency <n>      Max files to run in parallel (default: CPU-based, capped at 8; 1 = sequential)
      --config <path>        Config file to use, instead of searching for one
      --hermes <path>        Hermes binary path (overrides ARGUS_HERMES)
      --engine <name>        Hermes engine to target: legacy or v1 (default: the engine the project pins, preferring v1)
      --provision            Allow building Hermes from source when no binary is available (needs git, cmake, ninja)
  -h, --help                 Show this help

Environment:
  ARGUS_HERMES               Hermes binary path

Configuration:
  Searched upward from the working directory, stopping at the first package.json:
  argus.config.ts, argus.config.mts, argus.config.js, argus.config.mjs,
  .config/argus.config.ts, then the "argus" field of package.json.
  A CLI flag always wins over the config file.

    import { defineConfig } from '@arguslab/argus';
    export default defineConfig({ include: ['src/**/*.test.ts'], timeout: 30000 });

Hermes is taken from the first source that has one: --hermes/ARGUS_HERMES,
./.hermes/hermes in this project, the build cache in ~/.argus/cache, the legacy
VM bundled with react-native 0.73-0.82, a prebuilt binary downloaded from the
Argus releases, then a source build if --provision was passed.
`;

/**
 * The engine names `--engine` accepts. Rejecting anything else keeps a typo
 * from silently changing which engine runs. Re-exported from the domain so the
 * flag and the config file validate against one list.
 */
export { ENGINE_VALUES };

/** Maximum concurrency cap. Centralized so tests and runtime use the same value. */
export const DEFAULT_MAX_CONCURRENCY = DEFAULT_CONCURRENCY_CAP;

/**
 * Thrown by parseCliArgs when a CLI flag has an invalid value.
 * Callers (cli.ts) catch this, write the message to stderr, and set exitCode = 2.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * What the user actually typed.
 *
 * Every setting a config file can also supply is OPTIONAL here, and left absent
 * when the flag was not passed. That distinction is the whole basis of
 * precedence: a `concurrency` that arrives already filled in with a default is
 * indistinguishable from one the user asked for, and would beat the config file
 * on every run. Defaults are applied once, in `mergeConfig`.
 */
export interface CliArgs {
  patterns: string[];
  /** `--timeout`, in milliseconds. */
  timeoutMs?: number;
  /** `--config <path>`. */
  config?: string;
  hermes?: string;
  /** Explicit engine override; omit to use the project's own pin. */
  engine?: HermesEngine;
  /** True when `--provision` was passed. Absent means the flag was not given. */
  provision?: boolean;
  help: boolean;
  concurrency?: number;
}

/** Raw shape `parseArgs` returns before validation. */
interface RawValues {
  timeout?: string;
  concurrency?: string;
  config?: string;
  hermes?: string;
  engine?: string;
  provision?: boolean;
  help?: boolean;
}

function callParseArgs(argv: string[]): { values: RawValues; positionals: string[] } {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      timeout: { type: 'string', short: 't' },
      concurrency: { type: 'string', short: 'c' },
      config: { type: 'string' },
      hermes: { type: 'string' },
      engine: { type: 'string' },
      provision: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  }) as { values: RawValues; positionals: string[] };
}

/**
 * The flags that take a number, as `[long, short, example]`.
 *
 * Used both to validate a parsed value and to recognise the TypeError
 * `parseArgs` raises when the value itself looks like another option.
 */
const NUMERIC_FLAGS: readonly (readonly [string, string, string])[] = [
  ['--timeout', '-t', '5000, 30000'],
  ['--concurrency', '-c', '1, 4, 8'],
];

/**
 * Parse a flag that must be a positive integer.
 *
 * Rejects rather than falls back. `--timeout abc` used to be silently replaced
 * by the 10 000 ms default, so a typo produced a full green run under a timeout
 * the user never chose and was never told about — the same class of silent
 * substitution the config validator exists to prevent, and inconsistent with
 * `--concurrency`, which has always hard-failed.
 *
 * Accepts `/^[1-9][0-9]*$/` only: no 0, no negatives, no floats, no `1e2`, no
 * trailing junk, no whitespace.
 */
function parsePositiveInteger(
  raw: string | undefined,
  flag: string,
  example: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new UsageError(
      `Invalid ${flag} value: ${JSON.stringify(raw)}. Must be a positive integer (e.g. ${example}).`,
    );
  }
  return Number(raw);
}

/**
 * Validate `--engine`.
 *
 * An unrecognised value is rejected rather than ignored: silently falling back
 * to the default policy would run the tests on an engine the user did not ask
 * for, which is the exact failure this flag exists to prevent.
 */
function parseEngine(raw: string | undefined): HermesEngine | undefined {
  if (raw === undefined) return undefined;

  const value = raw.trim();
  for (const engine of ENGINE_VALUES) {
    if (value === engine) return engine;
  }
  throw new UsageError(
    `Invalid --engine value: ${JSON.stringify(raw)}. Must be one of: ${ENGINE_VALUES.join(', ')}.`,
  );
}

/**
 * Parse CLI arguments using Node's built-in util.parseArgs.
 * Positional arguments become the glob patterns to discover test files.
 * Options:
 *   -t, --timeout <ms>        Per-file Hermes subprocess timeout (default: 10000)
 *   -c, --concurrency <n>     Max parallel files (default: clamp(availableParallelism(),1,8))
 *       --hermes <path>       Path to the Hermes binary (overrides ARGUS_HERMES env var)
 *       --engine <name>       Target engine: 'legacy' or 'v1' (default: the project's own pin)
 *       --provision           Allow building Hermes from source
 *   -h, --help                Show usage and exit 0
 *
 * Throws UsageError for invalid --concurrency and --engine values.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let values: RawValues;
  let positionals: string[];
  try {
    ({ values, positionals } = callParseArgs(argv));
  } catch (e) {
    // node:util parseArgs throws TypeError for ambiguous/invalid flag values
    // (e.g. --concurrency -1, where the value looks like another option).
    // Re-surface as UsageError so cli.ts can exit 2 cleanly instead of the
    // process dying with a stack trace.
    if (e instanceof TypeError) {
      const msg = (e as Error).message;
      for (const [flag, short, example] of NUMERIC_FLAGS) {
        if (msg.includes(flag) || msg.includes(`'${short}'`)) {
          throw new UsageError(
            `Invalid ${flag} value: must be a positive integer (e.g. ${example}).`,
          );
        }
      }
    }
    throw e;
  }

  const timeoutMs = parsePositiveInteger(values.timeout, '--timeout', '5000, 30000');
  const concurrency = parsePositiveInteger(values.concurrency, '--concurrency', '1, 4, 8');
  const engine = parseEngine(values.engine);

  return {
    patterns: positionals,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(values.config === undefined ? {} : { config: values.config }),
    hermes: values.hermes,
    ...(engine === undefined ? {} : { engine }),
    ...(values.provision === undefined ? {} : { provision: values.provision }),
    help: values.help ?? false,
  };
}

/** The concurrency used when neither the flag nor the config names one. */
export function defaultConcurrency(): number {
  return Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism()));
}

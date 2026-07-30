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
      --engine <name>        Hermes engine to target: legacy or v1 (default: the engine your react-native version ships)
      --provision            Allow building Hermes from source when no binary is available (needs git, cmake, ninja)
  -h, --help                 Show this help
      --version              Show the Argus version

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
  /** True when `--version` was passed. */
  version: boolean;
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
  version?: boolean;
}

interface OptionSpec {
  readonly type: 'string' | 'boolean';
  readonly short?: string;
  /**
   * Present on the flags that take a positive integer. Those get a message
   * naming the shape they wanted rather than the generic "needs a value" —
   * `--concurrency -1` is a value mistake, not a missing value.
   */
  readonly numericExample?: string;
}

/**
 * Every option Argus accepts, declared ONCE.
 *
 * `parseArgs` is configured from this table and the error reporter reads the
 * same table, so a new flag cannot be understood by the parser and unknown to
 * the diagnostics — which is the state `--version` would otherwise have been
 * added into.
 */
const OPTIONS = {
  timeout: { type: 'string', short: 't', numericExample: '5000, 30000' },
  concurrency: { type: 'string', short: 'c', numericExample: '1, 4, 8' },
  config: { type: 'string' },
  hermes: { type: 'string' },
  engine: { type: 'string' },
  provision: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} as const satisfies Record<string, OptionSpec>;

const OPTION_ENTRIES: readonly (readonly [string, OptionSpec])[] = Object.entries(OPTIONS);

function specFor(name: string): OptionSpec | undefined {
  return Object.hasOwn(OPTIONS, name) ? (OPTIONS as Record<string, OptionSpec>)[name] : undefined;
}

function longNameForShort(short: string): string | undefined {
  for (const [name, spec] of OPTION_ENTRIES) {
    if (spec.short === short) return name;
  }
  return undefined;
}

function callParseArgs(argv: string[]): { values: RawValues; positionals: string[] } {
  const options: Record<string, { type: 'string' | 'boolean'; short?: string }> = {};
  for (const [name, spec] of OPTION_ENTRIES) {
    options[name] =
      spec.short === undefined ? { type: spec.type } : { type: spec.type, short: spec.short };
  }
  return parseArgs({ args: argv, allowPositionals: true, options }) as {
    values: RawValues;
    positionals: string[];
  };
}

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
 * The failure codes `node:util.parseArgs` documents.
 *
 * These are the stable part of that API. The MESSAGE is not: the previous
 * version decided whether a failure was a usage error by searching the message
 * for the literal string `--concurrency`, which quietly stops matching the day
 * Node rewords it — and only ever covered two flags, so every other malformed
 * argument escaped as a raw TypeError and was reported as an infrastructure
 * failure.
 */
const PARSE_ARGS_CODES = new Set([
  'ERR_PARSE_ARGS_UNKNOWN_OPTION',
  'ERR_PARSE_ARGS_INVALID_OPTION_VALUE',
  'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL',
]);

function parseArgsCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && PARSE_ARGS_CODES.has(code) ? code : undefined;
}

/** Why an option token is wrong, or undefined when it looks fine. */
function faultFor(
  flag: string,
  name: string,
  inlineValue: string | undefined,
  next: string | undefined,
): string | undefined {
  const spec = specFor(name);
  if (spec === undefined) {
    return `Unknown option '${flag}'.`;
  }
  if (spec.type === 'boolean') {
    return inlineValue === undefined ? undefined : `Option '${flag}' does not take a value.`;
  }
  if (inlineValue !== undefined) return undefined;

  // A string option whose value is missing, or looks like another option —
  // `--concurrency -1` is the case that made this specialisation necessary.
  const hasValue = next !== undefined && !(next.startsWith('-') && next.length > 1);
  if (hasValue) return undefined;
  return spec.numericExample === undefined
    ? `Option '${flag}' requires a value.`
    : `Invalid ${flag} value: must be a positive integer (e.g. ${spec.numericExample}). ` +
        `To pass a value that starts with a dash, write ${flag}=<value>.`;
}

/**
 * Find, and describe, the argument that made `parseArgs` fail.
 *
 * Deliberately a DESCRIBER, not a second parser: it only runs once `parseArgs`
 * has already rejected the command line, so it may treat every dash-led token
 * before `--` as an option without worrying that one might really be a value —
 * had it been a value, `parseArgs` would have accepted the line and this would
 * never be called. That is what keeps it short enough to be obviously correct,
 * and independent of Node's message wording.
 */
function describeArgvFault(argv: readonly string[]): string | undefined {
  for (let at = 0; at < argv.length; at++) {
    const token = argv[at];
    if (token === '--') return undefined;
    if (token.length < 2 || !token.startsWith('-')) continue;
    const next = argv[at + 1];

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const inline = eq === -1 ? undefined : token.slice(eq + 1);
      const fault = faultFor(`--${name}`, name, inline, next);
      if (fault !== undefined) return fault;
      continue;
    }

    // Short form, possibly clustered (`-hc 4`) or with an attached value (`-c4`).
    const chars = token.slice(1);
    for (let i = 0; i < chars.length; i++) {
      const short = chars[i];
      const name = longNameForShort(short);
      if (name === undefined) return `Unknown option '-${short}'.`;
      if (specFor(name)?.type !== 'string') continue;
      const attached = chars.slice(i + 1);
      const fault = faultFor(`-${short}`, name, attached === '' ? undefined : attached, next);
      if (fault !== undefined) return fault;
      break; // whatever followed in this token was the value
    }
  }
  return undefined;
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
 *       --version             Show the version and exit 0
 *
 * Every malformed argument — unknown option, missing value, a value handed to a
 * boolean flag, a value that is not the shape the flag wants — throws
 * UsageError. Nothing about a command line reaches the caller as a raw
 * TypeError, because a typo is not an infrastructure failure.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let values: RawValues;
  let positionals: string[];
  try {
    ({ values, positionals } = callParseArgs(argv));
  } catch (e) {
    if (parseArgsCode(e) === undefined) throw e;
    // Prefer our own description, which names the offending token from argv.
    // Node's message is the fallback rather than the source, so a rewording
    // there degrades the wording and never the classification.
    throw new UsageError(describeArgvFault(argv) ?? (e as Error).message);
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
    version: values.version ?? false,
  };
}

/** The concurrency used when neither the flag nor the config names one. */
export function defaultConcurrency(): number {
  return Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism()));
}

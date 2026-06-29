import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';

export const USAGE = `argus — run React Native tests on the standalone Hermes engine

Usage:
  argus [globs...]           Discover and run test files (default: **/*.test.ts)

Options:
  -t, --timeout <ms>         Per-file Hermes timeout in ms (default: 10000)
  -c, --concurrency <n>      Max files to run in parallel (default: CPU-based, capped at 8; 1 = sequential)
      --hermes <path>        Hermes binary path (overrides ARGUS_HERMES)
  -h, --help                 Show this help

Environment:
  ARGUS_HERMES               Hermes binary path (fallback: ./.hermes/hermes)
`;

/** Maximum concurrency cap. Centralized so tests and runtime use the same value. */
export const DEFAULT_MAX_CONCURRENCY = 8;

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

export interface CliArgs {
  patterns: string[];
  timeoutMs: number;
  hermes?: string;
  help: boolean;
  concurrency: number;
}

function callParseArgs(argv: string[]): {
  values: { timeout?: string; concurrency?: string; hermes?: string; help?: boolean };
  positionals: string[];
} {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      timeout: { type: 'string', short: 't' },
      concurrency: { type: 'string', short: 'c' },
      hermes: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  }) as {
    values: { timeout?: string; concurrency?: string; hermes?: string; help?: boolean };
    positionals: string[];
  };
}

/**
 * Parse CLI arguments using Node's built-in util.parseArgs.
 * Positional arguments become the glob patterns to discover test files.
 * Options:
 *   -t, --timeout <ms>        Per-file Hermes subprocess timeout (default: 10000)
 *   -c, --concurrency <n>     Max parallel files (default: clamp(availableParallelism(),1,8))
 *       --hermes <path>       Path to the Hermes binary (overrides ARGUS_HERMES env var)
 *   -h, --help                Show usage and exit 0
 *
 * Throws UsageError for invalid --concurrency values.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let values: { timeout?: string; concurrency?: string; hermes?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = callParseArgs(argv));
  } catch (e) {
    // node:util parseArgs throws TypeError for ambiguous/invalid flag values
    // (e.g. --concurrency -1 is treated as an unknown short option).
    // Re-surface as UsageError so cli.ts can exit 2 cleanly.
    if (e instanceof TypeError) {
      const msg = (e as Error).message;
      if (msg.includes('--concurrency') || msg.includes("'-c'")) {
        throw new UsageError(
          `Invalid --concurrency value: must be a positive integer (e.g. 1, 4, 8).`,
        );
      }
    }
    throw e;
  }

  const timeoutMs = values.timeout !== undefined ? Number(values.timeout) : 10_000;

  // --concurrency validation: strict positive-integer only
  // Accepts: /^[1-9][0-9]*$/ AND Number.isSafeInteger(Number(raw))
  // Rejects: 0, negatives, floats (1.5), scientific (1e2), mixed (2abc), whitespace
  let concurrency: number;
  if (values.concurrency !== undefined) {
    const raw = values.concurrency;
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new UsageError(
        `Invalid --concurrency value: ${JSON.stringify(raw)}. Must be a positive integer (e.g. 1, 4, 8).`,
      );
    }
    concurrency = Number(raw);
  } else {
    concurrency = Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, availableParallelism()));
  }

  return {
    patterns: positionals,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
    hermes: values.hermes,
    help: values.help ?? false,
    concurrency,
  };
}

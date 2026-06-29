import { parseArgs } from 'node:util';

export const USAGE = `argus — run React Native tests on the standalone Hermes engine

Usage:
  argus [globs...]           Discover and run test files (default: **/*.test.ts)

Options:
  -t, --timeout <ms>         Per-file Hermes timeout in ms (default: 10000)
      --hermes <path>        Hermes binary path (overrides ARGUS_HERMES)
  -h, --help                 Show this help

Environment:
  ARGUS_HERMES               Hermes binary path (fallback: ./.hermes/hermes)
`;

export interface CliArgs {
  patterns: string[];
  timeoutMs: number;
  hermes?: string;
  help: boolean;
}

/**
 * Parse CLI arguments using Node's built-in util.parseArgs.
 * Positional arguments become the glob patterns to discover test files.
 * Options:
 *   -t, --timeout <ms>   Per-file Hermes subprocess timeout (default: 10000)
 *       --hermes <path>  Path to the Hermes binary (overrides ARGUS_HERMES env var)
 *   -h, --help           Show usage and exit 0
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      timeout: { type: 'string', short: 't' },
      hermes: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const timeoutMs = values.timeout !== undefined ? Number(values.timeout) : 10_000;

  return {
    patterns: positionals,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
    hermes: values.hermes,
    help: values.help ?? false,
  };
}

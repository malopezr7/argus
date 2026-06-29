import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_PATTERN = '**/*.test.ts';

/**
 * Resolves test file paths from glob patterns relative to the given cwd.
 *
 * - If patterns is empty, falls back to the default pattern '**‌/*.test.ts'.
 * - node_modules is always excluded from results.
 * - Results are deduplicated across overlapping patterns.
 * - Returns absolute paths sorted lexicographically (stable, deterministic).
 * - Returns [] when no files match — caller decides how to handle zero-match.
 */
export async function resolveFiles(patterns: string[], cwd: string): Promise<string[]> {
  const effectivePatterns = patterns.length > 0 ? patterns : [DEFAULT_PATTERN];
  const seen = new Set<string>();

  for (const pattern of effectivePatterns) {
    for await (const hit of fsPromises.glob(pattern, {
      cwd,
      exclude: (p) => p.includes('node_modules'),
    })) {
      // hits are relative to cwd — resolve to absolute
      seen.add(join(cwd, hit));
    }
  }

  return [...seen].sort();
}

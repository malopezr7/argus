import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from '@arguslab/core';

/**
 * Resolves test file paths from glob patterns relative to the given root.
 *
 * - Empty `patterns` falls back to the default TS and TSX patterns.
 * - `exclude` is a list of GLOB PATTERNS, matched against paths relative to
 *   `root`. Passing `[]` disables exclusion entirely.
 * - Results are deduplicated across overlapping patterns.
 * - Returns absolute paths sorted lexicographically (stable, deterministic).
 * - Returns [] when no files match — the caller decides how to handle that.
 *
 * Exclusion is a glob rather than a string test on purpose. The previous rule
 * was `path.includes('node_modules')`, which also skipped any directory whose
 * NAME merely contained that string — a fixtures directory named
 * `my-node_modules-fixtures/` was silently dropped and its tests never ran,
 * reported as a pass. A glob asks about path segments, which is the question
 * that was meant all along.
 */
export async function resolveFiles(
  patterns: readonly string[],
  root: string,
  exclude: readonly string[] = DEFAULT_EXCLUDE,
): Promise<string[]> {
  const effectivePatterns = patterns.length > 0 ? patterns : DEFAULT_INCLUDE;
  const seen = new Set<string>();

  for (const pattern of effectivePatterns) {
    for await (const hit of fsPromises.glob(pattern, {
      cwd: root,
      exclude: [...exclude],
    })) {
      // hits are relative to root — resolve to absolute
      seen.add(join(root, hit));
    }
  }

  return [...seen].sort();
}

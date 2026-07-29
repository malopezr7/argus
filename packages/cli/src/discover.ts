import { promises as fsPromises } from 'node:fs';
import { isAbsolute, join, matchesGlob, relative, sep } from 'node:path';
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from '@arguslab/core';

/**
 * Resolves test file paths from glob patterns relative to the given root.
 *
 * - Empty `patterns` falls back to the default TS and TSX patterns.
 * - A pattern may be relative to `root` or ABSOLUTE. An absolute one is
 *   honoured as written, including when it points outside `root`.
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
      // A relative pattern yields hits relative to root; an ABSOLUTE pattern
      // yields absolute ones. Joining the root onto those produced
      // `<root><root>/file.test.ts`, a path that cannot exist — so every
      // absolute pattern died in the bundler, unable to resolve its own entry.
      const file = isAbsolute(hit) ? hit : join(root, hit);

      if (escapesRoot(root, file) && matchesAny(file, exclude)) continue;

      seen.add(file);
    }
  }

  return [...seen].sort();
}

/**
 * True when `file` lies outside `root`.
 *
 * Compared segment-wise rather than by string prefix: a sibling directory
 * named `..dotted/` produces a root-relative path starting with `..` while
 * sitting firmly INSIDE the root, and treating it as an escape would apply the
 * wrong exclusion basis to it.
 */
function escapesRoot(root: string, file: string): boolean {
  const rootRelative = relative(root, file);
  return rootRelative === '..' || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative);
}

/**
 * Whether an escaping hit is excluded.
 *
 * Node applies its own `exclude` only while walking below `cwd`; a pattern that
 * reaches outside the root bypasses it completely, so `**​/node_modules/**` would
 * stop working exactly where a stray dependency tree is most likely to be
 * picked up. Those hits are therefore filtered here.
 *
 * Matched against the ABSOLUTE path, because the root-relative form of a file
 * outside the root is a `../..` chain that `**` does not match — and because a
 * root-anchored pattern like `fixtures/**` is meaningless for a file that is
 * not under the root in the first place.
 */
function matchesAny(file: string, exclude: readonly string[]): boolean {
  for (const pattern of exclude) {
    if (matchesGlob(file, pattern)) return true;
  }
  return false;
}

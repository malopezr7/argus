/**
 * On-disk layout knowledge for Hermes binaries — PURE.
 *
 * Expressed as path SEGMENTS rather than joined strings because `@arguslab/core`
 * must never import `node:path`. Callers join them against a root with their
 * platform's separator.
 *
 * This lives in core because two packages need the same layout: the source
 * build adapter WRITES the cache, and the CLI's provisioning chain READS it.
 * Duplicating the segments would let the two drift into a cache that is written
 * to one path and looked up at another.
 */

/** Root of Argus' own cache, relative to the user's home directory. */
export const ARGUS_CACHE_SEGMENTS: readonly string[] = ['.argus', 'cache'];

/**
 * Directory holding a built Hermes for `tag`, relative to the home directory.
 *
 * The tag is used verbatim as the directory name so two engines pinned by the
 * same project cache side by side.
 */
export function hermesCacheRootSegments(tag: string): string[] {
  return [...ARGUS_CACHE_SEGMENTS, `hermes-${tag}`];
}

/** The built `hermes` executable for `tag`, relative to the home directory. */
export function hermesCacheBinarySegments(tag: string): string[] {
  return [...hermesCacheRootSegments(tag), 'build', 'bin', 'hermes'];
}

/**
 * A Hermes binary vendored inside the project under test, relative to its root.
 *
 * A deliberate, zero-cost convention: drop a binary at `./.hermes/hermes` and
 * Argus will use it without any flag or environment variable. It ranks below
 * `--hermes`/`ARGUS_HERMES` (which name a path outright) and above the build
 * cache, so a binary the user placed there always beats one Argus built.
 */
export const PROJECT_VENDORED_VM_SEGMENTS: readonly string[] = ['.hermes', 'hermes'];

/**
 * The standalone legacy VM vendored inside the `react-native` npm tarball,
 * relative to the React Native install directory.
 *
 * Present in RN 0.73 through 0.82 only: absent before 0.73, removed in 0.83+.
 * It is a macOS Mach-O universal binary, it matches the RN patch exactly, and
 * it costs nothing to use — which makes it the best legacy source available
 * when the project is in that range.
 *
 * The sibling `hermesc` in the same directory is the COMPILER, not the VM. The
 * VM is the file named exactly `hermes`.
 */
export const BUNDLED_LEGACY_VM_SEGMENTS: readonly string[] = [
  'sdks',
  'hermesc',
  'osx-bin',
  'hermes',
];

import type { RunResult, Suite, TestCase } from '@argus/core';
import { SourceMapConsumer } from 'source-map';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const BUNDLE_BASENAME = 'run.argus-bundle.js';

/**
 * Parenthesized frame:  at <fn> (<path>:LINE:COL)
 * Groups: 1=prefix, 2=path, 3=line, 4=col, 5=suffix
 */
const PAREN_FRAME = /^(\s*at\s+.+?\s+\()([^()]+):(\d+):(\d+)(\)\s*)$/;

/**
 * Bare frame:  at <path>:LINE:COL   or   <path>:LINE:COL
 * Groups: 1=prefix, 2=path, 3=line, 4=col, 5=suffix
 */
const BARE_FRAME = /^(\s*(?:at\s+)?)([^()\s][^()]*?):(\d+):(\d+)(\s*)$/;

function isBundlePath(filePath: string): boolean {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  return base === BUNDLE_BASENAME;
}

function displaySource(source: string): string {
  return source.replace(/^\.\//, '');
}

function isInternalSource(source: string): boolean {
  // D5: cwd-relative PREFIX match (not substring) so a user path that merely
  // CONTAINS an internal segment — e.g. `examples/packages/core/foo.test.ts` —
  // is NOT misclassified as internal and IS remapped.
  const s = source.replace(/^\.\//, '');
  return (
    s.startsWith('packages/framework/') ||
    s.startsWith('packages/core/') ||
    s.startsWith('node_modules/') ||
    s.includes('/node_modules/') ||
    s.startsWith('argus-virtual-entry') ||
    s === '<stdin>'
  );
}

// ---------------------------------------------------------------------------
// Frame-level remap
// ---------------------------------------------------------------------------

function remapFrame(line: string, c: SourceMapConsumer): string {
  const m = PAREN_FRAME.exec(line) ?? BARE_FRAME.exec(line);
  if (!m) return line;
  const [, pre, filePath, lineStr, colStr, post] = m;
  if (!isBundlePath(filePath)) return line; // D3: basename-only detection
  let orig: ReturnType<SourceMapConsumer['originalPositionFor']>;
  try {
    orig = c.originalPositionFor({
      line: Number(lineStr), // 1-based → passes through
      column: Number(colStr) - 1, // 1-based → 0-based for consumer
    });
  } catch {
    return line; // per-frame guard — never propagate
  }
  if (orig.source == null || orig.line == null) return line;
  if (isInternalSource(orig.source)) return line; // D5: keep framework/core/node_modules verbatim
  const outCol = (orig.column ?? 0) + 1; // 0-based → 1-based
  return `${pre}${displaySource(orig.source)}:${orig.line}:${outCol}${post}`;
}

function remapStack(stack: string, c: SourceMapConsumer): string {
  return stack
    .split('\n')
    .map((line) => remapFrame(line, c))
    .join('\n');
}

// ---------------------------------------------------------------------------
// failureMessage location remap (ADR-6)
// ---------------------------------------------------------------------------

function remapMessageLocation(message: string, c: SourceMapConsumer): string {
  const m = /^(.*?)(\s*\()?([^()\s]+):(\d+):(\d+)(\)?)\s*$/.exec(message);
  if (!m) return message;
  const [, head, openParen = '', filePath, lineStr, colStr, closeParen = ''] = m;
  if (!isBundlePath(filePath)) return message;
  let orig: ReturnType<SourceMapConsumer['originalPositionFor']>;
  try {
    orig = c.originalPositionFor({
      line: Number(lineStr),
      column: Number(colStr) - 1,
    });
  } catch {
    return message;
  }
  if (orig.source == null || orig.line == null || isInternalSource(orig.source)) return message;
  const outCol = (orig.column ?? 0) + 1;
  return `${head}${openParen}${displaySource(orig.source)}:${orig.line}:${outCol}${closeParen}`;
}

// ---------------------------------------------------------------------------
// TestCase / Suite tree remap
// ---------------------------------------------------------------------------

/** True when a string carries a bundle-location suffix (`run.argus-bundle.js:`). */
function hasBundleLocation(s: string | undefined): boolean {
  return s?.includes(`${BUNDLE_BASENAME}:`) ?? false;
}

function remapTest(t: TestCase, c: SourceMapConsumer): TestCase {
  // D4: failureStack and failureMessage are remapped INDEPENDENTLY
  const hasStack = t.status === 'failed' && t.failureStack != null;
  // D9: only treat a message as remappable when it actually carries a bundle location.
  const hasMessageLoc = t.status === 'failed' && hasBundleLocation(t.failureMessage);
  if (!hasStack && !hasMessageLoc) return t;
  const next: TestCase = { ...t };
  if (hasStack) {
    next.failureStack = remapStack(t.failureStack as string, c);
  }
  if (hasMessageLoc) {
    next.failureMessage = remapMessageLocation(t.failureMessage as string, c);
  }
  return next;
}

function remapSuite(suite: Suite, c: SourceMapConsumer): Suite {
  return {
    ...suite,
    suites: suite.suites.map((s) => remapSuite(s, c)),
    tests: suite.tests.map((t) => remapTest(t, c)),
  };
}

// ---------------------------------------------------------------------------
// hasRemappable: skip consumer construction if nothing to remap (D9)
// ---------------------------------------------------------------------------

function hasRemappable(suites: Suite[]): boolean {
  for (const suite of suites) {
    for (const t of suite.tests) {
      // D9: a stack (always bundle-relative from Hermes) OR a message that carries
      // a bundle location. A plain assertion message (no location) is NOT remappable.
      if (
        t.status === 'failed' &&
        (t.failureStack != null || hasBundleLocation(t.failureMessage))
      ) {
        return true;
      }
    }
    if (hasRemappable(suite.suites)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rewrite bundle-pointing stack frames in a RunResult to their original
 * source positions using a V3 source map. Pure and TOTAL: never mutates the
 * input, never throws; on any failure mode returns the input unchanged or the
 * offending frame verbatim. Async because source-map's SourceMapConsumer API
 * is promise-based (ADR-5).
 *
 * @param result the RunResult from a passed/failed RunOutcome
 * @param map    the V3 source-map JSON string (SealedBundle.map), or undefined
 */
export async function remapStacks(result: RunResult, map: string | undefined): Promise<RunResult> {
  if (!map) return result; // absent map → no-op (ADR-5)
  if (!hasRemappable(result.suites)) return result; // D9: skip if nothing to remap
  let consumer: SourceMapConsumer;
  try {
    consumer = await new SourceMapConsumer(map); // throws on malformed JSON/map
  } catch {
    return result; // malformed map → no-op, raw stacks preserved
  }
  try {
    return { ...result, suites: result.suites.map((s) => remapSuite(s, consumer)) };
  } catch {
    return result; // defensive: the tree-walk is total, but NEVER let a throw escape (ADR-5)
  } finally {
    consumer.destroy();
  }
}

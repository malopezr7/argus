/**
 * Unit tests for remapStacks.
 *
 * Covers: AC-03..AC-10, AC-16..AC-19, REQ-14..REQ-18 per tasks.md.
 *
 * Strategy: hand-craft minimal V3 source maps using raw VLQ mappings so we
 * can control exactly which generated (line, column) maps to which original.
 *
 * VLQ field order per segment: [genCol, srcIdx, origLine, origCol, namesIdx?]
 * (each relative to previous segment in the same kind).
 *
 * For a single-source map with 3 generated lines, each containing one segment:
 *   Line 1 seg: genCol=0 src=0 origLine=0 origCol=0  => VLQ: AAAA
 *   Line 2 seg: genCol=0 src=0 origLine=1 origCol=0  => maps gen(2,1) → orig(2,1)
 *   Line 3 seg: genCol=0 src=0 origLine=2 origCol=0  => maps gen(3,1) → orig(3,1)
 *
 * We use a helper to build mappings from explicit {genLine, genCol, srcLine, srcCol} entries.
 *
 * NOTE: source-map VLQ encodes DIFFERENCES from the previous segment's fields.
 * Each line resets genCol difference (starts from 0 each line); src/line/col
 * diffs are cumulative across all segments.
 */
import type { RunResult, TestCase } from '@argus/core';
import { describe, expect, it, vi } from 'vitest';
import { remapStacks } from '../index.js';

// ---------------------------------------------------------------------------
// VLQ helpers for building test maps
// ---------------------------------------------------------------------------

function vlqEncode(n: number): string {
  // Base64-VLQ: sign bit in LSB of first group, then groups of 5 bits + continuation
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let value = n < 0 ? (-n << 1) | 1 : n << 1;
  do {
    let digit = value & 0x1f;
    value >>>= 5;
    if (value > 0) digit |= 0x20;
    result += BASE64[digit];
  } while (value > 0);
  return result;
}

function buildMappings(
  entries: Array<{ genLine: number; genCol: number; srcLine: number; srcCol: number }>,
): string {
  // Sort by genLine, then genCol
  const sorted = [...entries].sort((a, b) =>
    a.genLine !== b.genLine ? a.genLine - b.genLine : a.genCol - b.genCol,
  );

  // Track cumulative state for diff encoding
  let prevGenLine = 1;
  let prevSrcLine = 0;
  let prevSrcCol = 0;

  const lineGroups: string[][] = [];
  for (const { genLine, genCol, srcLine, srcCol } of sorted) {
    // Fill missing lines with empty
    while (lineGroups.length < genLine - 1) {
      lineGroups.push([]);
    }
    const lineIdx = genLine - 1;
    if (!lineGroups[lineIdx]) lineGroups[lineIdx] = [];

    // genCol diff resets per line
    const genColDiff = lineGroups[lineIdx].length === 0 ? genCol : genCol - 0;
    const srcLineDiff = srcLine - prevSrcLine;
    const srcColDiff = srcCol - prevSrcCol;

    // Encode: [genCol, src=0, srcLineDiff, srcColDiff]
    const seg =
      vlqEncode(genColDiff) +
      vlqEncode(0) + // source index always 0
      vlqEncode(srcLineDiff) +
      vlqEncode(srcColDiff);

    lineGroups[lineIdx].push(seg);
    prevSrcLine = srcLine;
    prevSrcCol = srcCol;
    if (genLine > prevGenLine) prevGenLine = genLine;
  }

  return lineGroups.map((segs) => segs.join(',')).join(';');
}

function makeMap(
  entries: Array<{ genLine: number; genCol: number; srcLine: number; srcCol: number }>,
  source = 'examples/math.test.ts',
): string {
  return JSON.stringify({
    version: 3,
    file: 'run.argus-bundle.js',
    sources: [source],
    sourcesContent: ['// stub'],
    mappings: buildMappings(entries),
  });
}

// ---------------------------------------------------------------------------
// RunResult builders
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<TestCase> = {}): RunResult {
  const test: TestCase = {
    name: 'test > fails',
    status: 'failed',
    failureMessage: 'expect(1).toBe(2)',
    failureStack: `Error: expect(1).toBe(2)
    at Object.<anonymous> (/tmp/argus-xyz/run.argus-bundle.js:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1376:14)`,
    ...overrides,
  };
  return {
    suites: [
      {
        name: 'math',
        suites: [],
        tests: [test],
      },
    ],
    totals: { passed: 0, failed: 1, skipped: 0, todo: 0, total: 1 },
    durationMs: 0,
  };
}

function getTest(result: RunResult): TestCase {
  return result.suites[0].tests[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('remapStacks', () => {
  // 5.1a — Mapped user frame rewritten; input not mutated (AC-03, REQ-14-A)
  it('5.1a: mapped user frame → rewritten to source:origLine:origCol, input not mutated', async () => {
    // gen(10,4) → orig(5,2) in 0-based terms
    // stack frame col=5 (1-based) → consumer col=4 (0-based), maps to srcCol=2 (0-based) → returned col=3 (1-based)
    const map = makeMap([{ genLine: 10, genCol: 4, srcLine: 5, srcCol: 2 }]);
    const input = makeResult({
      failureStack: `Error: expect(1).toBe(2)
    at Object.<anonymous> (/tmp/argus-xyz/run.argus-bundle.js:10:5)`,
    });
    const originalStack = input.suites[0].tests[0].failureStack;
    const output = await remapStacks(input, map);

    const outTest = getTest(output);
    expect(outTest.failureStack).toContain('examples/math.test.ts:6:3');
    // Input must NOT be mutated
    expect(input.suites[0].tests[0].failureStack).toBe(originalStack);
    // New object returned
    expect(output).not.toBe(input);
  });

  // 5.1b — Off-by-one column round-trip (ADR-3 column contract)
  it('5.1b: off-by-one column — stack col 5 (1-based) → lookup col 4 (0-based) → mapped col 2 (0-based) → output col 3 (1-based)', async () => {
    const map = makeMap([{ genLine: 20, genCol: 4, srcLine: 7, srcCol: 2 }]);
    const input = makeResult({
      failureStack: `    at foo (run.argus-bundle.js:20:5)`,
    });
    const output = await remapStacks(input, map);
    const stack = getTest(output).failureStack ?? '';
    // origLine=7 (0-based srcLine) → +1 = line 8 in 1-based; origCol=2 (0-based) → +1 = col 3 in 1-based
    expect(stack).toContain('examples/math.test.ts:8:3');
  });

  // 5.1c — Unmapped frame in 3-frame stack; order preserved (AC-04, REQ-16-C)
  it('5.1c: unmapped frame passes verbatim; mapped frames around it are rewritten; order preserved', async () => {
    // frame-A: gen(10,4) → orig(5,2); frame-B: gen(11,0) → no mapping; frame-C: gen(12,4) → orig(6,0)
    const map = makeMap([
      { genLine: 10, genCol: 4, srcLine: 5, srcCol: 2 },
      { genLine: 12, genCol: 4, srcLine: 6, srcCol: 0 },
    ]);
    const BUNDLE = 'run.argus-bundle.js';
    const input = makeResult({
      failureStack: [
        `    at A (${BUNDLE}:10:5)`,
        `    at B (${BUNDLE}:11:1)`,
        `    at C (${BUNDLE}:12:5)`,
      ].join('\n'),
    });
    const output = await remapStacks(input, map);
    const lines = (getTest(output).failureStack ?? '').split('\n');
    expect(lines[0]).toContain('examples/math.test.ts'); // frame-A remapped
    expect(lines[1]).toContain(`${BUNDLE}:11:1`); // frame-B verbatim (no mapping)
    expect(lines[2]).toContain('examples/math.test.ts'); // frame-C remapped
    expect(lines).toHaveLength(3);
  });

  // 5.1d — undefined map → no throw, same stacks (AC-05, REQ-16-A)
  it('5.1d: remapStacks(result, undefined) → returns same result, no throw', async () => {
    const input = makeResult();
    const output = await remapStacks(input, undefined);
    expect(output).toBe(input); // same reference (no-op early return)
  });

  // 5.1e — malformed map → no throw, stacks unchanged, nothing on stdout/stderr (AC-06, REQ-16-B)
  it('5.1e: malformed map → same stacks, no throw, no stdout/stderr', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const input = makeResult();
      const originalStack = getTest(input).failureStack;
      const output = await remapStacks(input, '<not json>');
      expect(getTest(output).failureStack).toBe(originalStack);
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  // 5.1f — Error: message line at top of stack → passes through unchanged (AC-07, REQ-14-C)
  it('5.1f: error-message line (no path:line:col) is unchanged at same index', async () => {
    const map = makeMap([{ genLine: 2, genCol: 0, srcLine: 1, srcCol: 0 }]);
    const input = makeResult({
      failureStack: [
        'Error: expect(1).toBe(2)',
        '    at Object.<anonymous> (run.argus-bundle.js:2:1)',
      ].join('\n'),
    });
    const output = await remapStacks(input, map);
    const lines = (getTest(output).failureStack ?? '').split('\n');
    expect(lines[0]).toBe('Error: expect(1).toBe(2)');
  });

  // 5.1g — Frame maps to packages/framework/src → kept as bundle offset (AC-08, REQ-17-A)
  it('5.1g: framework-internal frame → kept as run.argus-bundle.js:LINE:COL', async () => {
    const frameworkMap = makeMap(
      [{ genLine: 5, genCol: 0, srcLine: 1, srcCol: 0 }],
      'packages/framework/src/runner.ts',
    );
    const input = makeResult({
      failureStack: '    at run (run.argus-bundle.js:5:1)',
    });
    const output = await remapStacks(input, frameworkMap);
    const stack = getTest(output).failureStack ?? '';
    expect(stack).toContain('run.argus-bundle.js:5:1');
    expect(stack).not.toContain('packages/framework/src');
  });

  // 5.1h — Frame maps to examples/math.test.ts → rewritten (REQ-17-B)
  it('5.1h: user-source frame → rewritten to examples/math.test.ts:LINE:COL', async () => {
    const map = makeMap([{ genLine: 3, genCol: 0, srcLine: 3, srcCol: 0 }]);
    const input = makeResult({
      failureStack: '    at test (run.argus-bundle.js:3:1)',
    });
    const output = await remapStacks(input, map);
    const stack = getTest(output).failureStack ?? '';
    expect(stack).toContain('examples/math.test.ts');
    expect(stack).not.toContain('run.argus-bundle.js');
  });

  // 5.1i — failureMessage without location → byte-identical (AC-09, REQ-18-A)
  it('5.1i: failureMessage without path:line:col → unchanged', async () => {
    const map = makeMap([{ genLine: 1, genCol: 0, srcLine: 1, srcCol: 0 }]);
    const input = makeResult({
      failureMessage: 'expect(1).toBe(2)',
      failureStack: '    at test (run.argus-bundle.js:1:1)',
    });
    const output = await remapStacks(input, map);
    expect(getTest(output).failureMessage).toBe('expect(1).toBe(2)');
  });

  // 5.1j — failureMessage ending with <bundlepath>:5:10 → suffix replaced (AC-10, REQ-18-B)
  it('5.1j: failureMessage ending with bundle location → suffix remapped', async () => {
    const map = makeMap([{ genLine: 5, genCol: 9, srcLine: 3, srcCol: 4 }]);
    const input = makeResult({
      failureMessage: 'expect failed at run.argus-bundle.js:5:10',
      failureStack: '    at test (run.argus-bundle.js:5:10)',
    });
    const output = await remapStacks(input, map);
    const msg = getTest(output).failureMessage ?? '';
    expect(msg).toContain('examples/math.test.ts');
    expect(msg).not.toContain('run.argus-bundle.js');
  });

  // 5.1k — valid JSON that SourceMapConsumer rejects → input unchanged (REQ-16, AC-06)
  it('5.1k: valid JSON that SourceMapConsumer rejects (not a real V3 map) → result unchanged', async () => {
    const badMap = JSON.stringify({ not: 'a real source map' });
    const input = makeResult();
    const originalStack = getTest(input).failureStack;
    const output = await remapStacks(input, badMap);
    expect(getTest(output).failureStack).toBe(originalStack);
  });

  // 5.x — AC-17: non-bundle frame with mappable coords stays verbatim (D3)
  it('5.x AC-17: non-bundle frame basename stays verbatim even if coords would map', async () => {
    const map = makeMap([{ genLine: 10, genCol: 4, srcLine: 5, srcCol: 2 }]);
    const input = makeResult({
      failureStack: '    at foo (/some/other/file.js:10:5)',
    });
    const output = await remapStacks(input, map);
    const stack = getTest(output).failureStack ?? '';
    // Must be byte-identical to input (not remapped)
    expect(stack).toBe('    at foo (/some/other/file.js:10:5)');
  });

  // 5.x — AC-18: failed test with message-location and NO stack → message remapped (D4)
  it('5.x AC-18: message-location remapped even when failureStack is absent', async () => {
    const map = makeMap([{ genLine: 71, genCol: 25, srcLine: 10, srcCol: 5 }]);
    const input = makeResult({
      failureStack: undefined,
      failureMessage: 'at run.argus-bundle.js:71:26',
    });
    const output = await remapStacks(input, map);
    const msg = getTest(output).failureMessage ?? '';
    expect(msg).toContain('examples/math.test.ts');
    expect(msg).not.toContain('run.argus-bundle.js');
  });

  // 5.x — AC-19: packages/core/ frame stays verbatim (D5)
  it('5.x AC-19: packages/core/ frame stays verbatim', async () => {
    const coreMap = makeMap(
      [{ genLine: 5, genCol: 0, srcLine: 1, srcCol: 0 }],
      'packages/core/src/domain/types.ts',
    );
    const input = makeResult({
      failureStack: '    at types (run.argus-bundle.js:5:1)',
    });
    const output = await remapStacks(input, coreMap);
    const stack = getTest(output).failureStack ?? '';
    expect(stack).toContain('run.argus-bundle.js:5:1');
    expect(stack).not.toContain('packages/core/src');
  });

  // 5.x — AC-19 regression (D5): a USER path that merely CONTAINS an internal
  // segment is classified by PREFIX, so it IS remapped (not kept verbatim).
  it('5.x: user path containing "packages/core/" as a non-prefix segment is remapped', async () => {
    const userMap = makeMap(
      [{ genLine: 5, genCol: 0, srcLine: 7, srcCol: 3 }],
      'examples/packages/core/foo.test.ts', // user file, NOT an internal prefix
    );
    const input = makeResult({
      failureStack: '    at foo (run.argus-bundle.js:5:1)',
    });
    const output = await remapStacks(input, userMap);
    const stack = getTest(output).failureStack ?? '';
    // The point: the user path is REMAPPED (prefix classification, not substring),
    // so the bundle path is gone and the user source appears with a line:col.
    expect(stack).toMatch(/examples\/packages\/core\/foo\.test\.ts:\d+:\d+/);
    expect(stack).not.toContain('run.argus-bundle.js');
  });
});

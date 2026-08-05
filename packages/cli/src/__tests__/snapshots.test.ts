import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { RunResult, SnapshotRecord } from '@arguslab/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatSnapshotFile,
  loadSnapshotFile,
  parseSnapshotFile,
  reconcileSnapshotFile,
  snapshotPathFor,
} from '../snapshots.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'argus-snapshots-'));
  roots.push(root);
  return root;
}

function record(
  key: string,
  value: string,
  testPassed = true,
  status: SnapshotRecord['status'] = 'unchecked',
): SnapshotRecord {
  return { key, value, testPassed, status };
}

function result(
  snap: SnapshotRecord[],
  options: { failed?: number; filtered?: boolean } = {},
): RunResult {
  const failed = options.failed ?? 0;
  return {
    suites: [],
    totals: { passed: failed === 0 ? 1 : 0, failed, skipped: 0, todo: 0, total: 1 },
    durationMs: 0,
    snap,
    snapFiltered: options.filtered ?? failed > 0,
  };
}

function seed(path: string, entries: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatSnapshotFile(entries));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('snapshot file format', () => {
  it('places snapshots beside the test file using Jest naming', () => {
    const file = join('/project', 'src', 'button.test.tsx');
    expect(snapshotPathFor(file)).toBe(
      join('/project', 'src', '__snapshots__', 'button.test.tsx.snap'),
    );
  });

  it('writes byte-stable Jest v1 header and assignment conventions', () => {
    const text = formatSnapshotFile({
      'zeta 1': '{\n  "value": 2,\n}',
      'alpha 1': '"first"',
    });

    expect(text).toBe(`// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing

exports[\`alpha 1\`] = \`"first"\`;

exports[\`zeta 1\`] = \`{
  "value": 2,
}\`;
`);
  });

  it('round-trips backticks, backslashes, interpolation markers, and multiline bodies', () => {
    const entries = {
      'key ` \\ ${ 1': '"line\\n` ${ value"\nsecond line',
    };

    expect(parseSnapshotFile(formatSnapshotFile(entries))).toEqual(entries);
  });

  it.each([
    ['wrong header', '// Jest Snapshot v2, https://jestjs.io/docs/snapshot-testing\n'],
    [
      'duplicate key',
      '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n\n' +
        'exports[`same 1`] = `a`;\n\nexports[`same 1`] = `b`;\n',
    ],
    [
      'C0 key',
      '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n\n' +
        'exports[`bad\u0000key`] = `a`;\n',
    ],
    [
      'trailing code',
      '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n\n' +
        'exports[`same 1`] = `a`;\nconsole.log("run")\n',
    ],
  ])('rejects malformed %s files', (_label, source) => {
    expect(() => parseSnapshotFile(source)).toThrow(/snapshot/i);
  });
});

describe('snapshot persistence', () => {
  it('loads a missing file as an empty snapshot set', async () => {
    const testFile = join(tempRoot(), 'missing.test.ts');
    const loaded = await loadSnapshotFile(testFile);

    expect(loaded.exists).toBe(false);
    expect(loaded.entries).toEqual({});
    expect(basename(loaded.path)).toBe('missing.test.ts.snap');
  });

  it('writes a missing entry without -u', async () => {
    const testFile = join(tempRoot(), 'new.test.ts');
    const loaded = await loadSnapshotFile(testFile);
    const run = result([record('new snapshot 1', '"value"')]);

    await reconcileSnapshotFile({ loaded, result: run, update: false });

    expect(run.snap[0].status).toBe('added');
    expect(parseSnapshotFile(readFileSync(loaded.path, 'utf8'))).toEqual({
      'new snapshot 1': '"value"',
    });
  });

  it('updates only passed-test entries even when another test in the file fails', async () => {
    const root = tempRoot();
    const testFile = join(root, 'partial.test.ts');
    const path = snapshotPathFor(testFile);
    seed(path, { 'passed test 1': '"old"', 'failed test 1': '"keep"' });
    const loaded = await loadSnapshotFile(testFile);
    const run = result(
      [record('passed test 1', '"new"'), record('failed test 1', '"discard"', false)],
      { failed: 1, filtered: true },
    );

    await reconcileSnapshotFile({ loaded, result: run, update: true });

    expect(run.snap.map((entry) => entry.status)).toEqual(['updated', 'discarded']);
    expect(parseSnapshotFile(readFileSync(path, 'utf8'))).toEqual({
      'passed test 1': '"new"',
      'failed test 1': '"keep"',
    });
  });

  it('keeps a mismatch without -u and marks the host comparison failed', async () => {
    const root = tempRoot();
    const testFile = join(root, 'stale.test.ts');
    const path = snapshotPathFor(testFile);
    seed(path, { 'stale test 1': '"old"' });
    const loaded = await loadSnapshotFile(testFile);
    const run = result([record('stale test 1', '"new"', false)], {
      failed: 1,
      filtered: true,
    });

    await reconcileSnapshotFile({ loaded, result: run, update: false });

    expect(run.snap[0].status).toBe('failed');
    expect(parseSnapshotFile(readFileSync(path, 'utf8'))).toEqual({
      'stale test 1': '"old"',
    });
  });

  it('prunes obsolete entries only for a passed, unfiltered file under -u', async () => {
    const root = tempRoot();
    const testFile = join(root, 'prune.test.ts');
    const path = snapshotPathFor(testFile);
    seed(path, { 'keep 1': '"same"', 'obsolete 1': '"old"' });

    const loaded = await loadSnapshotFile(testFile);
    const run = result([record('keep 1', '"same"')]);
    await reconcileSnapshotFile({ loaded, result: run, update: true });

    expect(run.snap.map((entry) => [entry.key, entry.status])).toEqual([
      ['keep 1', 'matched'],
      ['obsolete 1', 'removed'],
    ]);
    expect(parseSnapshotFile(readFileSync(path, 'utf8'))).toEqual({ 'keep 1': '"same"' });

    seed(path, { 'keep 1': '"same"', 'obsolete 1': '"old"' });
    const filteredLoaded = await loadSnapshotFile(testFile);
    const filtered = result([record('keep 1', '"same"')], { filtered: true });
    await reconcileSnapshotFile({ loaded: filteredLoaded, result: filtered, update: true });

    expect(filtered.snap.at(-1)).toMatchObject({ key: 'obsolete 1', status: 'obsolete' });
    expect(parseSnapshotFile(readFileSync(path, 'utf8'))).toHaveProperty('obsolete 1');
  });

  it('deletes the snapshot file when safe pruning removes its last entry', async () => {
    const root = tempRoot();
    const testFile = join(root, 'empty.test.ts');
    const path = snapshotPathFor(testFile);
    seed(path, { 'gone 1': '"old"' });
    const loaded = await loadSnapshotFile(testFile);

    await reconcileSnapshotFile({ loaded, result: result([]), update: true });

    expect(() => readFileSync(path, 'utf8')).toThrow();
  });
});

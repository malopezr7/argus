import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HERMES = resolve(REPO, '.hermes/hermes');
const gated = existsSync(HERMES) ? it : it.skip;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runArgus(args: string[]): Run {
  const result = spawnSync('pnpm', ['argus', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ARGUS_HERMES: HERMES },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function source(value: string, second = false): string {
  return `describe('mutable snapshots', () => {
  test('first', () => expect(${JSON.stringify(value)}).toMatchSnapshot());
  ${
    second
      ? `test('second', () => expect({ value: ${JSON.stringify(value)} }).toMatchSnapshot());`
      : ''
  }
});
`;
}

describe('snapshot CLI lifecycle (needs .hermes/hermes)', () => {
  gated(
    'writes missing snapshots, fails stale bytes, and updates only with -u',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'argus-snapshot-e2e-'));
      try {
        const file = join(root, 'mutable.test.ts');
        const snap = join(root, '__snapshots__', 'mutable.test.ts.snap');
        writeFileSync(file, source('first'));

        const created = runArgus([file]);
        expect(created.status).toBe(0);
        const original = readFileSync(snap, 'utf8');
        expect(original).toContain('exports[`mutable snapshots first 1`]');

        writeFileSync(file, source('second'));
        const stale = runArgus([file]);
        expect(stale.status).toBe(1);
        expect(stale.stdout).toContain('Snapshot mismatch');
        expect(readFileSync(snap, 'utf8')).toBe(original);

        const updated = runArgus(['-u', file]);
        expect(updated.status).toBe(0);
        expect(readFileSync(snap, 'utf8')).toContain('"second"');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  gated(
    'persists a passed test write when another test in the file fails',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'argus-snapshot-partial-'));
      try {
        const file = join(root, 'partial.test.ts');
        const snap = join(root, '__snapshots__', 'partial.test.ts.snap');
        writeFileSync(
          file,
          `describe('partial snapshots', () => {
  test('passed', () => expect('keep').toMatchSnapshot());
  test('failed', () => {
    expect('discard').toMatchSnapshot();
    expect(false).toBe(true);
  });
});
`,
        );

        const run = runArgus([file]);

        expect(run.status).toBe(1);
        const persisted = readFileSync(snap, 'utf8');
        expect(persisted).toContain('partial snapshots passed 1');
        expect(persisted).not.toContain('partial snapshots failed 1');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  gated(
    'prunes obsolete entries only on a passed unfiltered -u run',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'argus-snapshot-prune-'));
      try {
        const file = join(root, 'prune.test.ts');
        const snap = join(root, '__snapshots__', 'prune.test.ts.snap');
        writeFileSync(file, source('same', true));
        expect(runArgus([file]).status).toBe(0);

        writeFileSync(file, source('same'));
        expect(runArgus([file]).status).toBe(0);
        expect(readFileSync(snap, 'utf8')).toContain('mutable snapshots second 1');

        expect(runArgus(['--update', file]).status).toBe(0);
        expect(readFileSync(snap, 'utf8')).not.toContain('mutable snapshots second 1');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two things a user hits before anything else: asking which version this
 * is, and mistyping a flag. Both are answered before Argus looks for a Hermes
 * binary, so these run everywhere — unlike `integration.test.ts`, which is
 * gated on a gitignored binary and therefore skipped on a fresh clone.
 *
 * Driven as a real subprocess. `--version` has to work from the INSTALLED
 * package as well, and the only difference between the two layouts is which
 * `package.json` is found on disk — which no in-process test can exercise.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const publishedVersion = (
  JSON.parse(readFileSync(join(REPO, 'packaging', 'package.json'), 'utf8')) as { version: string }
).version;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI directly through tsx rather than through `pnpm argus`.
 *
 * Going via pnpm meant these assertions were really assertions about what pnpm
 * decides to print: it echoes the command, and occasionally adds a line of its
 * own that no fixed prefix filter anticipates. That made `--version` compare a
 * bare version string against output pnpm had appended to, and the test failed
 * roughly one run in four. Spawning the entry point removes pnpm from the
 * measurement entirely, so what is captured is only ever Argus's own output.
 */
const TSX = join(REPO, 'node_modules', '.bin', 'tsx');
const CLI = join(REPO, 'packages', 'cli', 'src', 'cli.ts');

function runArgus(args: string[]): Run {
  const result = spawnSync(TSX, [CLI, ...args], { cwd: REPO, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('argus --version', () => {
  it('exits 0', () => {
    expect(runArgus(['--version']).status).toBe(0);
  });

  it('reports the version the package publishes', () => {
    expect(runArgus(['--version']).stdout.trim()).toBe(publishedVersion);
  });

  it('writes it to stdout, so it can be captured', () => {
    const { stdout, stderr } = runArgus(['--version']);

    expect(stdout).toContain(publishedVersion);
    expect(stderr.trim()).toBe('');
  });
});

/**
 * A mistyped flag used to be reported as `INFRASTRUCTURE FAILURE [host]` — the
 * same banner Argus uses when the Hermes binary is missing or the VM crashes,
 * and the same one an operator is meant to treat as "the tool is broken". A
 * typo is the user's, and it should read that way and show them the flags.
 */
describe('argus with an unknown flag', () => {
  it('exits 2', () => {
    expect(runArgus(['--nope']).status).toBe(2);
  });

  it('names the flag it did not recognise', () => {
    expect(runArgus(['--nope']).stderr).toContain('--nope');
  });

  it('calls it a usage error, not an infrastructure failure', () => {
    const { stderr } = runArgus(['--nope']);

    expect(stderr).toContain('Usage error');
    expect(stderr).not.toContain('INFRASTRUCTURE FAILURE');
  });

  it('prints the usage text, so the user can see the real flags', () => {
    const { stderr } = runArgus(['--nope']);

    expect(stderr).toContain('Usage:');
    expect(stderr).toContain('--engine');
    expect(stderr).toContain('--version');
  });

  it('leaks no stack trace', () => {
    expect(runArgus(['--nope']).stderr).not.toContain('    at ');
  });
});

describe('argus --help', () => {
  it('exits 0 and writes usage to stdout', () => {
    const { status, stdout } = runArgus(['--help']);

    expect(status).toBe(0);
    expect(stdout).toContain('Usage:');
  });
});

/**
 * The bug report form is part of the public surface too, and it drifted the
 * same way the declarations did: it told people Argus was unpublished and asked
 * for a commit hash, three npm releases after the first publish. Nothing
 * pinned it, so nothing noticed.
 *
 * It asks for the output of a real command, so the command is what pins it.
 */
describe('the bug report form matches the shipped CLI', () => {
  const form = readFileSync(join(REPO, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml'), 'utf8');

  it('asks for the version using a flag the CLI actually has', () => {
    expect(form).toContain('argus --version');
    expect(runArgus(['--version']).status).toBe(0);
  });

  it('does not tell people Argus is unpublished', () => {
    expect(form.toLowerCase()).not.toContain('unpublished');
  });
});

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

/**
 * Every case here boots a fresh `tsx` process, which is orders of magnitude
 * slower than an in-process assertion and — crucially — slows down FURTHER the
 * busier the machine is. Measured on this suite: ~300 ms per case when the file
 * runs alone, but 447-2426 ms for the very same cases under full-suite
 * parallelism, an inflation of up to 8x. Vitest's default budget is 5000 ms, so
 * the margin at that peak is barely 2x and evaporates entirely on a loaded
 * machine or a CI box, failing `pnpm test` non-deterministically.
 *
 * The number is not a delay — it is a ceiling, reached only on failure — so it
 * costs a passing run nothing. Same mechanism and same value as the sibling
 * subprocess suite, `integration.test.ts`.
 */
const SUBPROCESS_TIMEOUT_MS = 30_000;

describe('argus --version', () => {
  it(
    'exits 0',
    () => {
      expect(runArgus(['--version']).status).toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'reports the version the package publishes',
    () => {
      expect(runArgus(['--version']).stdout.trim()).toBe(publishedVersion);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'writes it to stdout, so it can be captured',
    () => {
      const { stdout, stderr } = runArgus(['--version']);

      expect(stdout).toContain(publishedVersion);
      expect(stderr.trim()).toBe('');
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

/**
 * A mistyped flag used to be reported as `INFRASTRUCTURE FAILURE [host]` — the
 * same banner Argus uses when the Hermes binary is missing or the VM crashes,
 * and the same one an operator is meant to treat as "the tool is broken". A
 * typo is the user's, and it should read that way and show them the flags.
 */
describe('argus with an unknown flag', () => {
  it(
    'exits 2',
    () => {
      expect(runArgus(['--nope']).status).toBe(2);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'names the flag it did not recognise',
    () => {
      expect(runArgus(['--nope']).stderr).toContain('--nope');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'calls it a usage error, not an infrastructure failure',
    () => {
      const { stderr } = runArgus(['--nope']);

      expect(stderr).toContain('Usage error');
      expect(stderr).not.toContain('INFRASTRUCTURE FAILURE');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'prints the usage text, so the user can see the real flags',
    () => {
      const { stderr } = runArgus(['--nope']);

      expect(stderr).toContain('Usage:');
      expect(stderr).toContain('--engine');
      expect(stderr).toContain('--version');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'leaks no stack trace',
    () => {
      expect(runArgus(['--nope']).stderr).not.toContain('    at ');
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

describe('argus --help', () => {
  it(
    'exits 0 and writes usage to stdout',
    () => {
      const { status, stdout } = runArgus(['--help']);

      expect(status).toBe(0);
      expect(stdout).toContain('Usage:');
    },
    SUBPROCESS_TIMEOUT_MS,
  );
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

  it(
    'asks for the version using a flag the CLI actually has',
    () => {
      expect(form).toContain('argus --version');
      expect(runArgus(['--version']).status).toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'does not tell people Argus is unpublished',
    () => {
      expect(form.toLowerCase()).not.toContain('unpublished');
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

/**
 * The guard that keeps the budget honest.
 *
 * Every case in this file was written against Vitest's default 5000 ms and
 * passed in isolation, which is exactly how the defect reached `main`: it only
 * shows up under the contention of a full-suite run, and only sometimes. A new
 * subprocess case added here would inherit the same trap silently.
 *
 * So the budget is asserted rather than assumed. The timeout is read from the
 * live task tree — the value Vitest will actually enforce — not from the source
 * text, so it cannot be satisfied by a comment or drift out of sync with what
 * the runner does.
 */
describe('the subprocess budget', () => {
  interface TimedTask {
    type: string;
    name: string;
    timeout?: number;
    tasks?: TimedTask[];
  }

  function everyTest(task: TimedTask, found: TimedTask[] = []): TimedTask[] {
    if (task.type === 'test') found.push(task);
    for (const child of task.tasks ?? []) everyTest(child, found);
    return found;
  }

  it(
    'is raised above the default for every case in this file',
    (ctx) => {
      const file = (ctx.task as unknown as { file: TimedTask }).file;

      const underBudgeted = everyTest(file)
        .filter((t) => (t.timeout ?? 0) < SUBPROCESS_TIMEOUT_MS)
        .map((t) => t.name);

      expect(underBudgeted).toEqual([]);
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

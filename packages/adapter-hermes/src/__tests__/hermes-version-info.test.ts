import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readHermesVersionInfo } from '../utils.js';

/**
 * Fake binaries are generated under the OS temp dir at test time — nothing here
 * is committed. They are Node scripts rather than shell scripts so the fixtures
 * carry no shell-quoting subtleties; the shebang is what makes them executable,
 * which is why the whole suite is skipped on Windows.
 */

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

/** Write an executable Node script and return its path. */
function createExecutable(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'argus-version-'));
  tempRoots.push(root);
  const path = join(root, 'fake-hermes');
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A binary that prints `text` on stdout and exits 0. */
function createPrinter(text: string): string {
  return createExecutable(`process.stdout.write(${JSON.stringify(text)});`);
}

const V1_VERSION_OUTPUT = `LLVM (http://llvm.org/):
  LLVH version 8.0.0svn
  Optimized build

Hermes JavaScript compiler and Virtual Machine.
  Hermes release version: 1.0.0
  HBC bytecode version: 98

  Features:
    Debugger
    Unicode RegExp Property Escapes
    Zip file input
`;

describe.skipIf(process.platform === 'win32')('readHermesVersionInfo', () => {
  it('parses the output of a binary that reports a version', () => {
    expect(readHermesVersionInfo(createPrinter(V1_VERSION_OUTPUT))).toEqual({
      releaseVersion: '1.0.0',
      bytecodeVersion: 98,
    });
  });

  it('reads bytecode 96 from a legacy-style report', () => {
    const output = V1_VERSION_OUTPUT.replace(
      'Hermes release version: 1.0.0\n  HBC bytecode version: 98',
      'Hermes release version: 0.12.0\n  HBC bytecode version: 96',
    );
    expect(readHermesVersionInfo(createPrinter(output))).toEqual({
      releaseVersion: '0.12.0',
      bytecodeVersion: 96,
    });
  });

  it('reports unknown when the binary exits non-zero', () => {
    const path = createExecutable("process.stderr.write('boom\\n'); process.exit(3);");
    expect(readHermesVersionInfo(path)).toEqual({});
  });

  it('reports unknown when a binary exits non-zero after printing a valid version', () => {
    const path = createExecutable(
      `process.stdout.write(${JSON.stringify(V1_VERSION_OUTPUT)}); process.exit(1);`,
    );
    expect(readHermesVersionInfo(path)).toEqual({});
  });

  it('reports unknown for output it does not recognise', () => {
    expect(readHermesVersionInfo(createPrinter('not a hermes binary\n'))).toEqual({});
  });

  it('reports unknown for a path that does not exist', () => {
    expect(readHermesVersionInfo(join(tmpdir(), 'argus-definitely-not-here'))).toEqual({});
  });

  it('reports unknown for a file that is not executable', () => {
    const root = mkdtempSync(join(tmpdir(), 'argus-version-'));
    tempRoots.push(root);
    const path = join(root, 'not-executable');
    writeFileSync(path, 'plain text');
    chmodSync(path, 0o644);
    expect(readHermesVersionInfo(path)).toEqual({});
  });
});

/**
 * Real binaries, when this machine happens to have them. They are the only
 * end-to-end proof that the labels the parser keys on match what Hermes prints,
 * so they run when present — and are skipped everywhere else so the suite stays
 * green on a machine that has never built Hermes.
 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const LEGACY_BINARY = join(REPO_ROOT, '.hermes', 'hermes');
const V1_BINARY = join(
  homedir(),
  '.argus',
  'cache',
  'hermes-hermes-v250829098.0.16',
  'build',
  'bin',
  'hermes',
);

/**
 * Which engine sits at a given path is not something a test can assume: the
 * vendored `.hermes/hermes` is legacy on the maintainer's machine and V1 in CI,
 * which downloads a prebuilt. Asserting on the path rather than the binary made
 * the suite pass for a reason that had nothing to do with the parser.
 *
 * What is actually under test is that the parser reads whatever Hermes printed,
 * so the expectation comes from the engine the binary reports, and the pair only
 * has to be self-consistent.
 */
const ENGINE_BYTECODE: Record<string, number> = { legacy: 96, v1: 98 };

function engineOf(binary: string): string | undefined {
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
  if (/bytecode version:\s*98/i.test(version)) return 'v1';
  if (/bytecode version:\s*96/i.test(version)) return 'legacy';
  return undefined;
}

describe('readHermesVersionInfo against real binaries', () => {
  for (const [label, binary] of [
    ['the vendored binary', LEGACY_BINARY],
    ['the provisioned V1 build', V1_BINARY],
  ] as const) {
    it.skipIf(!existsSync(binary))(`reads the engine and release ${label} reports`, () => {
      const engine = engineOf(binary);
      expect(engine, `${binary} reported no recognised bytecode version`).toBeDefined();

      const info = readHermesVersionInfo(binary);
      expect(info.bytecodeVersion).toBe(ENGINE_BYTECODE[engine as string]);
      expect(info.releaseVersion).toBeDefined();
      // The LLVM preamble also contains the word "version"; matching it would
      // return the toolchain's version for every binary.
      expect(info.releaseVersion).not.toBe('8.0.0svn');
    });
  }
});

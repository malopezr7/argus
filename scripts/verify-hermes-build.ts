/**
 * Gates a freshly built Hermes tree before it is allowed to be packaged.
 *
 * Run by the `hermes-prebuilt` workflow on every build, and runnable locally
 * against any built tree:
 *
 *   pnpm exec tsx scripts/verify-hermes-build.ts \
 *     --bin-dir ~/.argus/cache/hermes-<tag>/build/bin \
 *     --tag hermes-v250829098.0.16 --os darwin --cpu arm64
 *
 * The gates, weakest to strongest:
 *
 *  1. The three executables exist and are executable.
 *  2. The VM's own `--version` reports the bytecode version the tag's engine
 *     implies, and the release version that was baked in. Both are derived from
 *     the tag rather than hardcoded, so a legacy tag is held to the legacy
 *     numbers without a second code path.
 *  3. A fixture actually runs and prints what it should — parsing is not
 *     executing, and a VM that links but miscomputes would pass gate 2.
 *  4. Bytecode parity: the same source compiled by the freshly built `hermesc`
 *     and by the official `hermes-compiler` npm package that React Native
 *     itself ships must produce a byte-identical `.hbc`. This is the strongest
 *     evidence available that a build is faithful rather than merely working,
 *     and it is why the whole pipeline exists.
 */

import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  checkEngineFidelity,
  HERMES_BUILD_TARGETS,
  type HermesBinCpu,
  type HermesBinOs,
  hermesReleaseVersion,
  parseHermesTag,
  parseHermesVersionOutput,
  releaseVersionForRef,
} from '../packages/core/src/index.js';
import { fail, log, pass, run, runOrFail, sha256File, skip } from './lib/exec.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Both fixtures print this, so one expectation covers either engine. */
const EXPECTED_SMOKE_OUTPUT = '{"ok":true,"n":4,"label":"counter"}';

/**
 * Where the official compiler lives inside the `hermes-compiler` tarball, per
 * target. There is no linux-arm64 build in it — React Native does not ship one
 * — so that target has no counterpart to compare against and says so.
 */
const OFFICIAL_HERMESC_DIR: Readonly<Record<string, string | undefined>> = {
  'darwin-arm64': 'osx-bin',
  'darwin-x64': 'osx-bin',
  'linux-x64': 'linux64-bin',
  'linux-arm64': undefined,
};

interface Options {
  binDir: string;
  tag: string;
  os: HermesBinOs;
  cpu: HermesBinCpu;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      'bin-dir': { type: 'string' },
      tag: { type: 'string' },
      os: { type: 'string' },
      cpu: { type: 'string' },
    },
  });

  const binDir = values['bin-dir'];
  const tag = values.tag;
  const os = values.os;
  const cpu = values.cpu;

  if (binDir === undefined || tag === undefined || os === undefined || cpu === undefined) {
    fail('usage: verify-hermes-build --bin-dir <dir> --tag <tag> --os <os> --cpu <cpu>');
  }
  if (os !== 'darwin' && os !== 'linux') fail(`unsupported --os: ${os}`);
  if (cpu !== 'arm64' && cpu !== 'x64') fail(`unsupported --cpu: ${cpu}`);

  return { binDir, tag, os, cpu };
}

/** Gate 1 — the build produced runnable files. */
function verifyBinariesPresent(binDir: string): void {
  for (const target of HERMES_BUILD_TARGETS) {
    const path = join(binDir, target);

    if (!existsSync(path)) fail(`missing build output: ${path}`);

    const stat = statSync(path);
    if (!stat.isFile()) fail(`not a file: ${path}`);
    if ((stat.mode & 0o111) === 0) fail(`not executable: ${path}`);

    pass(`${target} present, executable, ${stat.size} bytes`);
  }
}

/** Gate 2 — the VM is the engine the tag names, and knows its own version. */
function verifySelfReport(binDir: string, tag: string): void {
  const ref = parseHermesTag(tag);
  if (ref === undefined) fail(`unparsable Hermes ref: ${tag}`);

  const result = run(join(binDir, 'hermes'), ['--version']);
  if (result.status !== 0) fail(`hermes --version exited ${result.status}\n${result.stderr}`);

  const info = parseHermesVersionOutput(result.stdout);
  const fidelity = checkEngineFidelity(ref.engine, info);

  if (fidelity.kind === 'unknown') {
    // Benign at run time, fatal here: a build that will not name its own
    // bytecode version cannot be published as a known engine.
    fail(`hermes --version reported no bytecode version\n${result.stdout.trim()}`);
  }
  if (fidelity.kind === 'mismatch') {
    fail(
      `bytecode version mismatch: tag ${tag} implies the ${fidelity.expected} engine ` +
        `(${fidelity.expectedBytecodeVersion}) but the binary reports ` +
        `${fidelity.actualBytecodeVersion}`,
    );
  }

  pass(`${fidelity.engine} engine, HBC bytecode version ${fidelity.bytecodeVersion}`);

  const expectedRelease = releaseVersionForRef(tag);
  if (expectedRelease === undefined) {
    skip('release version check', `${tag} carries no version to bake in`);
    return;
  }
  if (info.releaseVersion !== expectedRelease) {
    // A plain clone reports the CMake project default of 1.0.0, so this gate is
    // what proves -DHERMES_RELEASE_VERSION actually reached the configure step.
    fail(
      `release version mismatch: expected ${expectedRelease}, got ` +
        `${info.releaseVersion ?? '(none)'} — was -DHERMES_RELEASE_VERSION passed?`,
    );
  }

  pass(`release version ${info.releaseVersion}`);
}

/** The fixture the tag's engine can actually parse. */
function fixtureFor(tag: string): string {
  const ref = parseHermesTag(tag);
  const name = ref?.engine === 'legacy' ? 'smoke-legacy.js' : 'smoke-v1.js';
  return join(HERE, 'fixtures', name);
}

/** Gate 3 — the VM executes, not merely parses. */
function verifySmokeRun(binDir: string, fixture: string): void {
  const result = run(join(binDir, 'hermes'), [fixture]);
  if (result.status !== 0) fail(`smoke run exited ${result.status}\n${result.stderr}`);

  const output = result.stdout.trim();
  if (output !== EXPECTED_SMOKE_OUTPUT) {
    fail(`smoke output mismatch\n  expected: ${EXPECTED_SMOKE_OUTPUT}\n  actual:   ${output}`);
  }

  pass(`smoke run printed ${output}`);
}

/** Download the compiler React Native ships for `version`; return its path. */
function fetchOfficialHermesc(version: string, officialDir: string, workDir: string): string {
  // Packed from a scratch directory so the repository's own .npmrc and
  // workspace do not colour the download.
  runOrFail('npm', ['pack', `hermes-compiler@${version}`], workDir);

  const tarballs = readdirSync(workDir).filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    fail(`expected exactly one tarball from npm pack, found ${tarballs.length}`);
  }

  runOrFail('tar', ['-xzf', tarballs[0]], workDir);

  const hermesc = join(workDir, 'package', 'hermesc', officialDir, 'hermesc');
  if (!existsSync(hermesc)) fail(`official compiler not found at ${hermesc}`);

  // npm preserves mode bits, but a compiler that will not run is a confusing
  // way to discover otherwise.
  runOrFail('chmod', ['+x', hermesc]);

  return hermesc;
}

/** Gate 4 — the built compiler emits exactly what the official one emits. */
function verifyBytecodeParity(options: Options, fixture: string, workDir: string): void {
  const target = `${options.os}-${options.cpu}`;
  const officialDir = OFFICIAL_HERMESC_DIR[target];

  if (officialDir === undefined) {
    skip(
      'bytecode parity',
      `the hermes-compiler package ships osx-bin, linux64-bin and win64-bin only — ` +
        `there is no official ${target} compiler to compare against`,
    );
    return;
  }

  const version = hermesReleaseVersion(options.tag);
  if (version === undefined) {
    skip('bytecode parity', `${options.tag} does not name a published hermes-compiler version`);
    return;
  }

  const official = fetchOfficialHermesc(version, officialDir, workDir);
  const local = join(options.binDir, 'hermesc');

  const officialOut = join(workDir, 'official.hbc');
  const localOut = join(workDir, 'local.hbc');

  // The same input path for both, so nothing about the invocation differs
  // except which compiler ran.
  runOrFail(official, ['-emit-binary', '-out', officialOut, fixture]);
  runOrFail(local, ['-emit-binary', '-out', localOut, fixture]);

  const officialHash = sha256File(officialOut);
  const localHash = sha256File(localOut);

  if (officialHash !== localHash) {
    fail(
      'bytecode parity FAILED — this build does not compile like the engine ' +
        `React Native ships\n  official (hermes-compiler@${version}): ${officialHash}\n` +
        `  locally built:                        ${localHash}`,
    );
  }

  pass(`bytecode parity with hermes-compiler@${version} (sha256 ${localHash})`);
}

function main(): void {
  const options = parseOptions();
  const workDir = mkdtempSync(join(tmpdir(), 'argus-hermes-verify-'));
  const fixture = fixtureFor(options.tag);

  log(`verifying ${options.tag} for ${options.os}-${options.cpu}`);
  log(`  bin dir: ${options.binDir}`);

  verifyBinariesPresent(options.binDir);
  verifySelfReport(options.binDir, options.tag);
  verifySmokeRun(options.binDir, fixture);
  verifyBytecodeParity(options, fixture, workDir);

  log('all gates passed');
}

main();

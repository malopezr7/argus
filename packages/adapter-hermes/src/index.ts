import { execFileSync, spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  Engine,
  EngineOutput,
  EngineRunOptions,
  EngineTarget,
  HermesBinary,
  HermesProvisioner,
  SealedBundle,
} from '@argus/core';

// ---------------------------------------------------------------------------
// Engine adapter — spawns the `hermes` binary subprocess in FILE mode
// ---------------------------------------------------------------------------

/**
 * HermesSpawnEngine writes the sealed bundle to a temp FILE and spawns `hermes`
 * on it (NEVER stdin — that triggers REPL pollution, verified in Phase 0).
 * Enforces a timeout (SIGKILL), captures stdout/stderr, and always cleans up.
 */
export class HermesSpawnEngine implements Engine {
  async run(
    bundle: SealedBundle,
    bin: HermesBinary,
    opts: EngineRunOptions,
  ): Promise<EngineOutput> {
    const dir = mkdtempSync(join(tmpdir(), 'argus-'));
    const file = join(dir, 'run.argus-bundle.js');
    try {
      writeFileSync(file, bundle.code, 'utf8');
      return await spawnHermes(bin.path, file, opts);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function spawnHermes(binPath: string, file: string, opts: EngineRunOptions): Promise<EngineOutput> {
  return new Promise((resolveOutput) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(binPath, [file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const done = (exitCode: number | null, signal: string | null): void => {
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      resolveOutput({ stdout, stderr, exitCode, signal, timedOut, durationMs });
    };
    child.on('error', (err) => {
      stderr += String(err);
      done(null, null);
    });
    child.on('close', (exitCode, signal) => done(exitCode, signal ?? null));
  });
}

// ---------------------------------------------------------------------------
// HermesProvisioner adapters — three strategies from SPEC §6
// ---------------------------------------------------------------------------

/**
 * LocalPathAdapter (BYO) — resolves a user-supplied `hermes` binary.
 * Use cases: CI cache, monorepo-vendored binary, the Phase 0/1 spike binary.
 */
export class LocalPathAdapter implements HermesProvisioner {
  constructor(private readonly binaryPath: string) {}

  async resolve(_target: EngineTarget): Promise<HermesBinary> {
    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      throw new Error(
        `LocalPathAdapter: hermes binary not found at "${this.binaryPath}". ` +
          'Set ARGUS_HERMES or pass an explicit path.',
      );
    }
    accessSync(this.binaryPath, constants.X_OK);
    return {
      path: this.binaryPath,
      version: detectVersion(this.binaryPath),
      arch: detectArch(this.binaryPath),
    };
  }
}

function detectVersion(binPath: string): string {
  try {
    const out = execFileSync(binPath, ['--version'], { encoding: 'utf8' });
    const m = out.match(/version\s+([\w.\-+]+)/i);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function detectArch(binPath: string): 'arm64' | 'x64' {
  try {
    const out = execFileSync('file', [binPath], { encoding: 'utf8' });
    const hasArm = /arm64/.test(out);
    const hasX64 = /x86_64/.test(out);
    if (hasArm && !hasX64) return 'arm64';
    if (hasX64 && !hasArm) return 'x64';
  } catch {
    // fall through to host arch
  }
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * PrebuiltAdapter (default) — downloads a prebuilt hermes binary from Argus CI
 * artifact storage for the detected target. Signature/checksum-verified;
 * quarantine-stripped on macOS. TODO (Phase 2).
 */
export class PrebuiltAdapter implements HermesProvisioner {
  async resolve(_target: EngineTarget): Promise<HermesBinary> {
    throw new Error('NotImplemented: PrebuiltAdapter.resolve — Phase 2');
  }
}

/**
 * SourceBuildAdapter (fallback) — builds the Hermes VM from facebook/hermes
 * source, pinned to the tag/commit in the target React Native install's
 * `.hermesversion` (or `.hermesV1version`). The result is cached at
 * `~/.argus/cache/hermes-<ref>/build/bin/hermes`, so the (slow) build runs once.
 * Used by CI and by users on a (RN × OS × arch) combo without a published prebuilt.
 *
 * Requires `git`, `cmake`, and `ninja` on PATH. Verified against RN 0.86 →
 * `hermes-v0.17.0` (native arm64).
 */
export class SourceBuildAdapter implements HermesProvisioner {
  /** @param hermesRef explicit facebook/hermes ref; if omitted, read from the RN install. */
  constructor(private readonly hermesRef?: string) {}

  async resolve(_target: EngineTarget): Promise<HermesBinary> {
    const ref = this.hermesRef ?? resolveHermesRef();
    const root = join(homedir(), '.argus', 'cache', `hermes-${ref}`);
    const binary = join(root, 'build', 'bin', 'hermes');
    if (!existsSync(binary)) {
      buildHermesFromSource(ref, root);
    }
    accessSync(binary, constants.X_OK);
    return { path: binary, version: ref, arch: detectArch(binary) };
  }
}

/** Read the Hermes ref pinned by the nearest React Native install. */
function resolveHermesRef(): string {
  let dir = process.cwd();
  for (;;) {
    for (const file of ['.hermesV1version', '.hermesversion']) {
      const p = join(dir, 'node_modules', 'react-native', 'sdks', file);
      if (existsSync(p)) return readFileSync(p, 'utf8').trim();
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'SourceBuildAdapter: no React Native install found to read the pinned Hermes version ' +
      '(node_modules/react-native/sdks/.hermesversion). Pass an explicit ref to SourceBuildAdapter.',
  );
}

/** Clone facebook/hermes at `ref` and build the `hermes` VM target (Release). */
function buildHermesFromSource(ref: string, root: string): void {
  mkdirSync(root, { recursive: true });
  const src = join(root, 'hermes-src');
  const build = join(root, 'build');
  if (!existsSync(src)) {
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--branch', ref, 'https://github.com/facebook/hermes.git', src],
      { stdio: 'inherit' },
    );
  }
  execFileSync('cmake', ['-S', src, '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release'], {
    stdio: 'inherit',
  });
  execFileSync('cmake', ['--build', build, '--target', 'hermes'], { stdio: 'inherit' });
}

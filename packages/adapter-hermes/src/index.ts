import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * SourceBuildAdapter (fallback) — builds Hermes from facebook/hermes source at
 * the commit in `.hermesV1version`. ~20–40 min one-time build. TODO (Phase 2).
 */
export class SourceBuildAdapter implements HermesProvisioner {
  async resolve(_target: EngineTarget): Promise<HermesBinary> {
    throw new Error('NotImplemented: SourceBuildAdapter.resolve — Phase 2');
  }
}

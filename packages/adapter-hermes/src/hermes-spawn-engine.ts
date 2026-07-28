import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Engine,
  EngineOutput,
  EngineRunOptions,
  HermesBinary,
  SealedBundle,
} from '@arguslab/core';

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

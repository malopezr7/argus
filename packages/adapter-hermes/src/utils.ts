import { execFileSync } from 'node:child_process';

export function detectVersion(binPath: string): string {
  try {
    const out = execFileSync(binPath, ['--version'], { encoding: 'utf8' });
    const m = out.match(/version\s+([\w.\-+]+)/i);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function detectArch(binPath: string): 'arm64' | 'x64' {
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

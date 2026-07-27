import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildCmakeBuildArgs,
  buildCmakeConfigureArgs,
  type EngineTarget,
  type HermesBinary,
  type HermesProvisioner,
  hermesCacheBinarySegments,
  hermesCacheRootSegments,
  releaseVersionForRef,
} from '@argus/core';
import { resolveHermesEngine } from './engine-resolver.js';
import { detectArch, readHermesVersionInfo } from './utils.js';

/**
 * SourceBuildAdapter (fallback) — builds the Hermes VM (plus `hermesc` and
 * `hvm`) from facebook/hermes source, pinned to the tag/commit the target React
 * Native install declares (see `engine-resolver.ts` for the source precedence),
 * using RN's own build configuration. The result is cached at
 * `~/.argus/cache/hermes-<ref>/build/bin/hermes`, so the (slow) build runs once.
 * Used by CI and by users on a (RN × OS × arch) combo without a published prebuilt.
 *
 * Requires `git`, `cmake`, and `ninja` on PATH. Verified against RN 0.86 →
 * `hermes-v0.17.0` (native arm64).
 */
export class SourceBuildAdapter implements HermesProvisioner {
  /** @param hermesRef explicit facebook/hermes ref; if omitted, read from the RN install. */
  constructor(private readonly hermesRef?: string) {}

  async resolve(target: EngineTarget): Promise<HermesBinary> {
    const ref = this.hermesRef ?? resolveHermesRef(target.rnVersion);
    // Layout comes from @argus/core so the CLI's cache lookup and this writer
    // can never disagree about where a built binary lives.
    const home = homedir();
    const root = join(home, ...hermesCacheRootSegments(ref));
    const binary = join(home, ...hermesCacheBinarySegments(ref));
    if (!existsSync(binary)) {
      buildHermesFromSource(ref, root);
    }
    accessSync(binary, constants.X_OK);
    return {
      path: binary,
      version: ref,
      arch: detectArch(binary),
      // Read back what we just built rather than assuming the flags took: this
      // is what proves the binary is the engine the project pinned.
      ...readHermesVersionInfo(binary),
    };
  }
}

/**
 * Read the Hermes ref pinned by the nearest React Native install, falling back
 * to the offline RN-to-Hermes table when the install cannot be read.
 */
function resolveHermesRef(rnVersion?: string): string {
  const outcome = resolveHermesEngine({ rnVersion });
  if (outcome.kind === 'resolved') return outcome.resolution.ref.tag;

  throw new Error(
    'SourceBuildAdapter: no React Native install found to read the pinned Hermes version ' +
      '(node_modules/react-native/sdks/hermes-engine/version.properties, .hermesv1version, ' +
      'or .hermesversion). Pass an explicit ref to SourceBuildAdapter.',
  );
}

/** Check that cmake and ninja are on PATH before attempting a build. */
function checkPrerequisites(): void {
  const missing: string[] = [];
  for (const cmd of ['cmake', 'ninja']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    } catch {
      missing.push(cmd);
    }
  }
  if (missing.length === 0) return;

  const isMac = process.platform === 'darwin';
  const lines: string[] = [`Missing build prerequisites: ${missing.join(', ')}`, ''];
  if (isMac) {
    lines.push('On macOS, install them with Homebrew:');
    lines.push('');
    lines.push(`  brew install ${missing.join(' ')}`);
  } else {
    const packages = missing.map((c) => (c === 'ninja' ? 'ninja-build' : c));
    lines.push('On Debian/Ubuntu, install them with apt:');
    lines.push('');
    lines.push(`  sudo apt-get update && sudo apt-get install -y ${packages.join(' ')}`);
  }
  lines.push('');
  throw new Error(lines.join('\n'));
}

const HERMES_REPO_URL = 'https://github.com/facebook/hermes.git';

/**
 * Clone facebook/hermes at `ref` and build the VM, the compiler, and the
 * bytecode runner with the configuration React Native itself uses.
 *
 * The argument vectors are built by pure helpers in `@argus/core` so the flag
 * set is asserted by unit tests instead of only by a 95-second build.
 */
function buildHermesFromSource(ref: string, root: string): void {
  checkPrerequisites();
  mkdirSync(root, { recursive: true });
  const src = join(root, 'hermes-src');
  const build = join(root, 'build');
  if (!existsSync(src)) {
    execFileSync('git', ['clone', '--depth', '1', '--branch', ref, HERMES_REPO_URL, src], {
      stdio: 'inherit',
    });
  }

  const configureArgs = buildCmakeConfigureArgs({
    sourceDir: src,
    buildDir: build,
    platform: process.platform,
    releaseVersion: releaseVersionForRef(ref),
  });
  execFileSync('cmake', configureArgs, { stdio: 'inherit' });

  const buildArgs = buildCmakeBuildArgs({
    buildDir: build,
    parallelism: availableParallelism(),
  });
  execFileSync('cmake', buildArgs, { stdio: 'inherit' });
}

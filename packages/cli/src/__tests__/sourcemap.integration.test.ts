/**
 * Task 5.3 — Integration: real CLI subprocess proves source-map wiring (AC-11, AC-21, REQ-15-A).
 *
 * Runs the CLI as a real subprocess against examples/math-failing.test.ts and
 * asserts that the rendered failureStack USER-code frame references the source
 * file basename and original line — NOT run.argus-bundle.js.
 *
 * Per design D7/D8: internal frames MAY still contain run.argus-bundle.js;
 * the assertion is scoped to the USER-code frame only (AC-21, D8).
 *
 * Task 5.4 (AC-12) — Static: packages/core/package.json has no source-map dep.
 * Task 5.5 (AC-14) — Static: source-map appears only in adapter-sourcemap/package.json.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// cli/src/__tests__/ -> cli/src/ -> cli/ -> packages/ -> root
const HERE = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
// Pass the fixture as a cwd-RELATIVE glob (the CLI resolves globs relative to
// cwd; an absolute path would be re-joined onto cwd and fail to resolve).
const FAILING_FIXTURE = 'examples/math-failing.test.ts';
const CLI_ENTRY = resolve(REPO_ROOT, 'packages', 'cli', 'src', 'cli.ts');

// ---------------------------------------------------------------------------
// AC-11 / AC-21 — integration via real CLI subprocess
// ---------------------------------------------------------------------------

describe('source-map integration (AC-11, AC-21, REQ-15-A)', () => {
  it('failing example renders a user-code frame with the source file name and original line (not run.argus-bundle.js)', {
    timeout: 30_000,
  }, () => {
    // Run tsx directly (same as pnpm argus) to avoid pnpm recursion issues in test env
    const result = spawnSync('node', ['--import', 'tsx/esm', CLI_ENTRY, FAILING_FIXTURE], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    const combined = (result.stdout ?? '') + (result.stderr ?? '');

    // AC-21: the user-code frame must reference the source file AND its original
    // line (not just the basename, and not the bundle path).
    const lines = combined.split('\n');
    const userFrame = lines.find((l) => l.includes('math-failing.test.ts'));
    expect(userFrame).toBeDefined();
    expect(userFrame).not.toContain('run.argus-bundle.js');
    // The failing assertion lives at line 12 of the fixture → frame shows :12:
    expect(userFrame).toMatch(/math-failing\.test\.ts:12:\d+/);
  });
});

// ---------------------------------------------------------------------------
// Task 5.4 — AC-12: packages/core/package.json has no source-map dep
// ---------------------------------------------------------------------------

describe('static: @arguslab/core gains no source-map dep (AC-12, REQ-19)', () => {
  it('packages/core/package.json has no source-map in dependencies or devDependencies', () => {
    const pkgPath = resolve(REPO_ROOT, 'packages', 'core', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    expect(Object.keys(allDeps)).not.toContain('source-map');
  });
});

// ---------------------------------------------------------------------------
// Task 5.5 — AC-14: source-map dep isolated to adapter-sourcemap (REQ-19-C)
// ---------------------------------------------------------------------------

describe('static: source-map dep confined to adapter-sourcemap (AC-14, REQ-19-C)', () => {
  it('source-map appears only in packages/adapter-sourcemap/package.json', () => {
    const noSourceMapDirs = [
      'packages/core',
      'packages/cli',
      'packages/adapter-hermes',
      'packages/framework',
      'packages/reporter-cli',
    ];

    for (const dir of noSourceMapDirs) {
      const pkgPath = resolve(REPO_ROOT, dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      expect(Object.keys(allDeps), `${dir}/package.json must not have source-map`).not.toContain(
        'source-map',
      );
    }

    // Confirm adapter-sourcemap DOES have it
    const sourcemapPkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'packages', 'adapter-sourcemap', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(sourcemapPkg.dependencies ?? {})).toContain('source-map');
  });
});

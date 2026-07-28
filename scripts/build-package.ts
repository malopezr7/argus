/**
 * Stages the publishable package into `dist/`.
 *
 *   pnpm build
 *
 * The repo is eight workspace packages; exactly one is published. So the build
 * is a STAGING step, not a per-package compile: it assembles one directory that
 * IS the tarball, and `npm pack dist` turns it into one.
 *
 * Two kinds of code go in, and they are handled differently on purpose:
 *
 *   HOST CODE (cli, core, adapters, reporter) runs on Node. It is bundled into a
 *   single ESM file. The artifact is a binary, not a library — nobody imports it
 *   — so it needs no declarations, and collapsing the internal package seam into
 *   one file means the hexagonal boundaries cost the user nothing at install
 *   time. Only the four real npm dependencies stay external.
 *
 *   RUNTIME ASSETS (framework, rntl) run on Hermes. They are copied VERBATIM as
 *   TypeScript, because esbuild compiles them on the user's machine at run time,
 *   against the engine their project pins. Compiling them here would bake in one
 *   engine's syntax envelope and defeat the point.
 */

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fail, log, pass } from './lib/exec.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(REPO, 'dist');

/**
 * The npm packages the CLI genuinely needs at run time.
 *
 * esbuild ships a platform-specific native binary, `@babel/core` resolves
 * plugins dynamically, and `source-map` loads a WASM file — none of the three
 * survives being inlined, and there is no reason to try. Everything else in the
 * bundle is our own workspace code.
 */
const RUNTIME_DEPENDENCIES = [
  'esbuild',
  '@babel/core',
  '@babel/plugin-transform-classes',
  'source-map',
];

/** Workspace packages copied verbatim as `runtime/<name>/src`. */
const RUNTIME_ASSET_PACKAGES = ['framework', 'rntl'];

interface Manifest {
  name: string;
  version: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(REPO, 'packaging', 'package.json'), 'utf8')) as Manifest;
}

/**
 * Guard against the manifest and the bundle disagreeing about what is external.
 *
 * A dependency externalised here but missing from the manifest produces a
 * package that installs cleanly and then fails on first run with a bare module
 * resolution error. That is the worst failure mode available, so it is checked
 * at build time instead of discovered by a user.
 */
function assertDependenciesDeclared(manifest: Manifest): void {
  const missing = RUNTIME_DEPENDENCIES.filter((name) => !(name in manifest.dependencies));
  if (missing.length > 0) {
    fail(`packaging/package.json is missing runtime dependencies: ${missing.join(', ')}`);
  }
}

async function bundleHost(manifest: Manifest): Promise<string> {
  const binPath = Object.values(manifest.bin)[0];
  const outfile = join(OUT, binPath);

  const result = await build({
    entryPoints: [join(REPO, 'packages', 'cli', 'src', 'cli.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: RUNTIME_DEPENDENCIES,
    legalComments: 'none',
    metafile: true,
  });

  const inputs = Object.keys(result.metafile.inputs).length;
  log(`  bundled ${inputs} host modules -> ${binPath} (${kb(statSync(outfile).size)})`);
  return outfile;
}

/**
 * A CLI whose first line is not a hashbang is not runnable through `bin`.
 *
 * esbuild carries the entry point's own hashbang through, which is a behaviour
 * worth asserting rather than assuming: losing it produces a package that
 * installs fine and then fails with a syntax error from the shell.
 */
function assertExecutable(outfile: string): void {
  const firstLine = readFileSync(outfile, 'utf8').split('\n', 1)[0];
  if (!firstLine.startsWith('#!')) {
    fail(`${relative(REPO, outfile)} lost its hashbang — it would not be runnable as a bin`);
  }
  chmodSync(outfile, statSync(outfile).mode | 0o111);
  pass(`hashbang preserved: ${firstLine}`);
}

/**
 * Copy the Hermes-side sources.
 *
 * The two-level `<name>/src` shape is preserved deliberately: `rntl/src/index.ts`
 * imports `../../framework/src/lifecycle.js`, so the relative distance between
 * the two packages is part of the contract. Flattening the copy would break that
 * import at bundle time on the user's machine, which is the worst place to find
 * out. `packages/cli/src/paths.ts` resolves this same shape.
 */
function stageRuntimeAssets(): void {
  for (const name of RUNTIME_ASSET_PACKAGES) {
    const source = join(REPO, 'packages', name, 'src');
    if (!existsSync(source)) fail(`runtime asset source is missing: ${source}`);
    const target = join(OUT, 'runtime', name, 'src');
    cpSync(source, target, { recursive: true });
    log(`  staged runtime/${name}/src (${countFiles(target)} files)`);
  }
}

function stageMetadata(): void {
  cpSync(join(REPO, 'packaging', 'package.json'), join(OUT, 'package.json'));
  mkdirSync(join(OUT, 'types'), { recursive: true });
  cpSync(join(REPO, 'packaging', 'argus.d.ts'), join(OUT, 'types', 'argus.d.ts'));
  cpSync(join(REPO, 'README.md'), join(OUT, 'README.md'));
  cpSync(join(REPO, 'LICENSE'), join(OUT, 'LICENSE'));
}

function countFiles(root: string): number {
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(join(root, entry.name)) : 1;
  }
  return total;
}

function listFiles(root: string, prefix = ''): string[] {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(root, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Nothing internal may reach the tarball.
 *
 * Tests, tsconfigs and incremental build info are all cheap to include by
 * accident and embarrassing to publish, so the staged tree is checked rather
 * than trusted.
 */
const FORBIDDEN = [/(^|\/)__tests__\//, /\.tsbuildinfo$/, /(^|\/)tsconfig[^/]*\.json$/];

function assertNothingLeaked(): void {
  const leaked = listFiles(OUT).filter((file) => FORBIDDEN.some((rule) => rule.test(file)));
  if (leaked.length > 0) {
    fail(`internal files staged into the package:\n  ${leaked.join('\n  ')}`);
  }
  pass('no test, tsconfig or build-info files staged');
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<void> {
  const manifest = readManifest();
  assertDependenciesDeclared(manifest);

  log(`Building ${manifest.name}@${manifest.version}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  assertExecutable(await bundleHost(manifest));
  stageRuntimeAssets();
  stageMetadata();
  assertNothingLeaked();

  const files = listFiles(OUT);
  const bytes = files.reduce((sum, file) => sum + statSync(join(OUT, file)).size, 0);
  log(`\n${files.length} files, ${kb(bytes)} staged in dist/`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});

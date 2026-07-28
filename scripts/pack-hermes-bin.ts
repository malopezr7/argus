/**
 * Builds one `@argus/hermes-bin-<os>-<cpu>` package from an already-built
 * Hermes tree. The `hermes-prebuilt` workflow calls this, and so can a
 * maintainer wanting to inspect a package without spending CI minutes:
 *
 *   pnpm exec tsx scripts/pack-hermes-bin.ts \
 *     --bin-dir ~/.argus/cache/hermes-<tag>/build/bin \
 *     --tag hermes-v250829098.0.16 --os darwin --cpu arm64 \
 *     --out /tmp/argus-bins --thin --pack
 *
 * One invocation produces one package. macOS builds a single universal binary
 * and runs this twice with `--thin`, slicing that one build into an arm64 and
 * an x64 package, so a user downloads roughly half of a universal binary rather
 * than all of it.
 *
 * Package identity — name, version, manifest — comes from `@argus/core` rather
 * than from here, because the provisioning side has to arrive at exactly the
 * same answers.
 */

import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  HERMES_BIN_DIR,
  HERMES_BUILD_TARGETS,
  type HermesBinCpu,
  type HermesBinManifest,
  type HermesBinPlatform,
  hermesBinPackageManifest,
  hermesBinPackageName,
  hermesBinPackageVersion,
  parseHermesTag,
} from '../packages/core/src/index.js';
import { fail, log, pass, runOrFail, sha256File } from './lib/exec.js';

/** Mode the shipped executables must carry. */
const EXECUTABLE_MODE = 0o755;

/** `lipo` names architectures the way the Mach-O header does, not the way Node does. */
const LIPO_ARCH: Readonly<Record<HermesBinCpu, string>> = {
  arm64: 'arm64',
  x64: 'x86_64',
};

interface Options {
  binDir: string;
  tag: string;
  platform: HermesBinPlatform;
  outDir: string;
  /** Slice the matching architecture out of a universal binary. */
  thin: boolean;
  /** Also run `npm pack` and verify the resulting tarball. */
  pack: boolean;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      'bin-dir': { type: 'string' },
      tag: { type: 'string' },
      os: { type: 'string' },
      cpu: { type: 'string' },
      out: { type: 'string' },
      thin: { type: 'boolean', default: false },
      pack: { type: 'boolean', default: false },
    },
  });

  const binDir = values['bin-dir'];
  const tag = values.tag;
  const os = values.os;
  const cpu = values.cpu;
  const out = values.out;

  if (
    binDir === undefined ||
    tag === undefined ||
    os === undefined ||
    cpu === undefined ||
    out === undefined
  ) {
    fail(
      'usage: pack-hermes-bin --bin-dir <dir> --tag <tag> --os <os> --cpu <cpu> ' +
        '--out <dir> [--thin] [--pack]',
    );
  }
  if (os !== 'darwin' && os !== 'linux') fail(`unsupported --os: ${os}`);
  if (cpu !== 'arm64' && cpu !== 'x64') fail(`unsupported --cpu: ${cpu}`);
  if (values.thin && os !== 'darwin') fail('--thin applies only to macOS universal binaries');

  return {
    binDir: resolve(binDir),
    tag,
    platform: { os, cpu },
    outDir: resolve(out),
    thin: values.thin,
    pack: values.pack,
  };
}

/** Copy or slice one executable into the package, with the right mode. */
function placeBinary(options: Options, target: string, packageBinDir: string): void {
  const source = join(options.binDir, target);
  const destination = join(packageBinDir, target);

  if (options.thin) {
    runOrFail('lipo', [source, '-thin', LIPO_ARCH[options.platform.cpu], '-output', destination]);
  } else {
    copyFileSync(source, destination);
  }

  // cmake produces 0755 and copyFileSync preserves it, but `lipo` creates a new
  // file and the mode is the whole point of shipping an executable.
  chmodSync(destination, EXECUTABLE_MODE);

  const { size } = statSync(destination);
  pass(`${HERMES_BIN_DIR}/${target}  ${size} bytes  mode ${EXECUTABLE_MODE.toString(8)}`);
}

function readme(manifest: HermesBinManifest, tag: string, platform: HermesBinPlatform): string {
  return `# ${manifest.name}

Prebuilt Hermes binaries for \`${platform.os}-${platform.cpu}\`, built from
[facebook/hermes](https://github.com/facebook/hermes) at tag \`${tag}\`.

| File | What it is |
| --- | --- |
| \`bin/hermes\` | The VM. Runs JavaScript or compiled bytecode. |
| \`bin/hermesc\` | The compiler. Emits HBC bytecode. |
| \`bin/hvm\` | The bytecode-only VM. |

## Do not depend on this package directly

It is fetched at run time by [Argus](https://github.com/malopezr7/argus), which
picks the Hermes version your project actually pins — React Native 0.83 and 0.86
want different ones, with the same Argus installed. That is why this package is
versioned by the **Hermes** version (\`${manifest.version}\`) and not by the
Argus version, and why no Argus package lists it as a dependency.

Install Argus instead and let it resolve the binary.

## Provenance

Built in CI with the configuration React Native uses for its own Hermes builds:
\`HERMES_ENABLE_INTL=ON\`, \`HERMES_ENABLE_DEBUGGER=ON\`,
\`HERMES_ENABLE_TEST_SUITE=OFF\`, \`CMAKE_BUILD_TYPE=Release\`.

Every build is gated on bytecode parity: the same source compiled by this
\`hermesc\` and by the official \`hermes-compiler@${manifest.version}\` package
React Native ships must produce a byte-identical \`.hbc\`.

## Licence

Hermes is MIT licensed, which is what this package declares, matching Meta's own
\`hermes-compiler\` package for the same binaries. The build statically links the
vendored \`llvh\`, which is Apache-2.0 WITH LLVM-exception.
`;
}

/** The shape of `npm pack --json` that this script relies on. */
interface PackReport {
  filename: string;
  files: { path: string; mode: number }[];
}

function parsePackReport(stdout: string): PackReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail(`npm pack --json did not return JSON:\n${stdout.trim()}`);
  }

  const report = Array.isArray(parsed) ? parsed[0] : undefined;
  if (typeof report?.filename !== 'string' || !Array.isArray(report.files)) {
    fail(`npm pack --json returned an unexpected shape:\n${stdout.trim()}`);
  }

  return report as PackReport;
}

/** `npm pack` the package and prove the executable bit survived the round trip. */
function packAndVerify(packageDir: string, outDir: string): void {
  // Plain `npm`, not `pnpm`: these packages have no workspace dependencies, so
  // there is no `workspace:*` protocol to rewrite and nothing pnpm adds.
  //
  // `--json` because it reports each entry's mode as a number, which is exactly
  // what needs checking and does not vary between bsdtar and GNU tar the way
  // `tar -tvf` output does.
  const report = parsePackReport(
    runOrFail('npm', ['pack', '--json', '--pack-destination', outDir], packageDir).stdout,
  );

  for (const target of HERMES_BUILD_TARGETS) {
    const entry = report.files.find((file) => file.path === `${HERMES_BIN_DIR}/${target}`);
    if (entry === undefined) fail(`tarball is missing ${HERMES_BIN_DIR}/${target}`);
    // npm documents that it preserves mode bits; a package of executables that
    // are not executable is silent enough to be worth reading back.
    if (entry.mode !== EXECUTABLE_MODE) {
      fail(
        `tarball lost the executable bit on ${target}: mode ` +
          `${entry.mode.toString(8)}, expected ${EXECUTABLE_MODE.toString(8)}`,
      );
    }
  }

  // npm ships README.md regardless of `files`; confirm rather than trust it.
  if (!report.files.some((file) => file.path === 'README.md')) {
    fail('tarball is missing README.md');
  }

  const tarball = join(outDir, report.filename);
  const digest = sha256File(tarball);
  // shasum-compatible, so `shasum -a 256 -c <file>.sha256` verifies it as-is.
  writeFileSync(`${tarball}.sha256`, `${digest}  ${report.filename}\n`);

  const { size } = statSync(tarball);
  pass(`packed ${report.filename}  ${size} bytes`);
  pass(`sha256 ${digest}`);
}

function main(): void {
  const options = parseOptions();

  const ref = parseHermesTag(options.tag);
  if (ref === undefined) fail(`unparsable Hermes ref: ${options.tag}`);

  const version = hermesBinPackageVersion(options.tag);
  if (version === undefined) {
    fail(
      `${options.tag} cannot name an npm version — date-based refs and bare ` +
        'commit SHAs are not publishable under this scheme',
    );
  }

  const manifest = hermesBinPackageManifest({
    platform: options.platform,
    version,
    tag: options.tag,
    engine: ref.engine,
  });

  const packageDir = join(options.outDir, `${options.platform.os}-${options.platform.cpu}`);
  const packageBinDir = join(packageDir, HERMES_BIN_DIR);

  log(`building ${hermesBinPackageName(options.platform)}@${version}`);
  log(`  from: ${options.binDir}${options.thin ? ' (slicing universal binary)' : ''}`);
  log(`  into: ${packageDir}`);

  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageBinDir, { recursive: true });

  for (const target of HERMES_BUILD_TARGETS) {
    placeBinary(options, target, packageBinDir);
  }

  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(packageDir, 'README.md'), readme(manifest, options.tag, options.platform));
  pass('package.json and README.md written');

  if (options.pack) packAndVerify(packageDir, options.outDir);

  log('done');
}

main();

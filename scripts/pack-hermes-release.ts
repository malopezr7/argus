/**
 * Builds one release archive from an already-built Hermes tree. The
 * `hermes-prebuilt` workflow calls this, and so can a maintainer wanting to
 * inspect an archive without spending CI minutes:
 *
 *   pnpm exec tsx scripts/pack-hermes-release.ts \
 *     --bin-dir ~/.argus/cache/hermes-<tag>/build/bin \
 *     --tag hermes-v250829098.0.16 --os darwin --cpu arm64 \
 *     --out /tmp/argus-bins --thin
 *
 * One invocation produces one archive plus its checksum. macOS builds a single
 * universal binary and runs this twice with `--thin`, slicing that one build
 * into an arm64 and an x64 archive, so a user downloads roughly half of a
 * universal binary rather than all of it.
 *
 * Asset identity — tag, name, checksum file — comes from `@argus/core` rather
 * than from here, because the provisioning side has to arrive at exactly the
 * same answers.
 *
 * The tar is written by `@argus/hermes`'s own encoder rather than by shelling
 * out to the system `tar`. That is not fussiness: macOS `bsdtar` writes
 * AppleDouble `._*` companion entries for extended attributes unless
 * `COPYFILE_DISABLE` is set, so shelling out would put junk in the archive on
 * the macOS runner and not on the Linux ones. Encoding here also fixes every
 * timestamp and owner, which makes the published checksum reproducible.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readTarGz, writeTarGz } from '../packages/adapter-hermes/src/tar.js';
import {
  HERMES_BUILD_TARGETS,
  type HermesBinCpu,
  type HermesBinPlatform,
  hermesAssetName,
  hermesChecksumAssetName,
  hermesReleaseTag,
  hermesReleaseVersion,
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
      'usage: pack-hermes-release --bin-dir <dir> --tag <tag> --os <os> --cpu <cpu> ' +
        '--out <dir> [--thin]',
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
  };
}

/** Read one executable's bytes, slicing it out of a universal binary if asked. */
function readBinary(options: Options, target: string, stagingDir: string): Buffer {
  const source = join(options.binDir, target);
  if (!options.thin) return readFileSync(source);

  const sliced = join(stagingDir, target);
  runOrFail('lipo', [source, '-thin', LIPO_ARCH[options.platform.cpu], '-output', sliced]);
  return readFileSync(sliced);
}

/**
 * Unpack the archive again and check it holds what it should.
 *
 * The executable bit is the load-bearing part: an archive of binaries that
 * extract without it produces a permission error much later, at the point a
 * user runs their tests, with nothing pointing back to here.
 */
function verifyRoundTrip(archive: Buffer, expected: Map<string, Buffer>): void {
  const entries = readTarGz(archive);

  const paths = entries.map((entry) => entry.path).sort();
  if (paths.join(',') !== [...expected.keys()].sort().join(',')) {
    fail(`archive holds ${paths.join(', ')}, expected ${[...expected.keys()].join(', ')}`);
  }

  for (const entry of entries) {
    if (entry.mode !== EXECUTABLE_MODE) {
      fail(
        `archive lost the executable bit on ${entry.path}: mode ` +
          `${entry.mode.toString(8)}, expected ${EXECUTABLE_MODE.toString(8)}`,
      );
    }
    if (!entry.data.equals(expected.get(entry.path) as Buffer)) {
      fail(`archive contents for ${entry.path} do not match the input`);
    }
  }

  pass(`round trip: ${paths.join(', ')} at mode ${EXECUTABLE_MODE.toString(8)}`);
}

function main(): void {
  const options = parseOptions();

  const ref = parseHermesTag(options.tag);
  if (ref === undefined) fail(`unparsable Hermes ref: ${options.tag}`);

  const version = hermesReleaseVersion(options.tag);
  const releaseTag = hermesReleaseTag(options.tag);
  if (version === undefined || releaseTag === undefined) {
    fail(
      `${options.tag} cannot name a release version — date-based refs and bare ` +
        'commit SHAs are not publishable under this scheme',
    );
  }

  const assetName = hermesAssetName(options.platform, version);
  log(`building ${assetName}  (release ${releaseTag})`);
  log(`  from: ${options.binDir}${options.thin ? ' (slicing universal binary)' : ''}`);
  log(`  into: ${options.outDir}`);

  const staging = mkdtempSync(join(tmpdir(), 'argus-pack-'));
  const contents = new Map<string, Buffer>();
  try {
    for (const target of HERMES_BUILD_TARGETS) {
      const data = readBinary(options, target, staging);
      contents.set(target, data);
      pass(`${target}  ${data.length} bytes`);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const archive = writeTarGz(
    HERMES_BUILD_TARGETS.map((target) => ({
      path: target,
      mode: EXECUTABLE_MODE,
      data: contents.get(target) as Buffer,
    })),
  );

  verifyRoundTrip(archive, contents);

  mkdirSync(options.outDir, { recursive: true });
  const archivePath = join(options.outDir, assetName);
  writeFileSync(archivePath, archive);

  const digest = sha256File(archivePath);
  // shasum-compatible, so `shasum -a 256 -c <file>.sha256` verifies it as-is.
  writeFileSync(
    join(options.outDir, hermesChecksumAssetName(assetName)),
    `${digest}  ${assetName}\n`,
  );

  pass(`packed ${assetName}  ${statSync(archivePath).size} bytes`);
  pass(`sha256 ${digest}`);
  log('done');
}

main();

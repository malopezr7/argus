import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { readTar, readTarGz, TarError, writeTar, writeTarGz } from '../tar.js';

/**
 * The reader has to survive two very different producers: the system `tar`,
 * whose exact output varies (macOS bsdtar interleaves pax extended headers and,
 * unless COPYFILE_DISABLE is set, AppleDouble `._*` companions), and our own
 * writer. Fixtures are therefore built at test time from both, and the hostile
 * archives are hand-assembled because no real `tar` will write them.
 */

const BLOCK_SIZE = 512;
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;
const TYPEFLAG_OFFSET = 156;

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-tar-'));
  tempRoots.push(dir);
  return dir;
}

/**
 * Build an archive with the system `tar`.
 *
 * `COPYFILE_DISABLE` suppresses macOS AppleDouble companions by default so the
 * entry set is predictable; one test deliberately leaves it on to prove the
 * reader copes with the untamed output too.
 */
function systemTarGz(cwd: string, names: string[], appleDouble = false): Buffer {
  const out = join(tempDir(), 'archive.tar.gz');
  const env = { ...process.env };
  if (!appleDouble) env.COPYFILE_DISABLE = '1';
  else delete env.COPYFILE_DISABLE;

  const result = spawnSync('tar', ['-czf', out, '-C', cwd, ...names], { env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`tar failed (${result.status}): ${result.stderr}`);
  }
  return readFileSync(out);
}

/** A directory holding the given files, with the given modes. */
function fixtureDir(files: { name: string; content: string; mode: number }[]): string {
  const dir = tempDir();
  for (const file of files) {
    writeFileSync(join(dir, file.name), file.content);
    chmodSync(join(dir, file.name), file.mode);
  }
  return dir;
}

/** Recompute a header block's checksum after tampering with it. */
function reseal(block: Buffer): void {
  block.fill(0x20, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0'), CHECKSUM_OFFSET, 'latin1');
  block[CHECKSUM_OFFSET + 6] = 0;
  block[CHECKSUM_OFFSET + 7] = 0x20;
}

/** Byte offset of the first regular-file header, skipping any pax records. */
function firstFileHeaderOffset(tar: Buffer): number {
  for (let offset = 0; offset + BLOCK_SIZE <= tar.length; offset += BLOCK_SIZE) {
    const block = tar.subarray(offset, offset + BLOCK_SIZE);
    if (block.every((byte) => byte === 0)) break;

    const typeflag = String.fromCharCode(block[TYPEFLAG_OFFSET] as number);
    if (typeflag === '0' || typeflag === '\0') return offset;

    const size = Number.parseInt(
      tar
        .toString('latin1', offset + 124, offset + 135)
        .replace(/\0/g, ' ')
        .trim() || '0',
      8,
    );
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  throw new Error('fixture archive holds no regular file');
}

/**
 * Rewrite the first file entry's name to `path`, keeping the archive valid.
 *
 * It has to find the entry rather than assume block zero: macOS bsdtar puts a
 * pax extended header in front of every file, so block zero is metadata.
 */
function retargetFirstEntry(tar: Buffer, path: string): Buffer {
  const patched = Buffer.from(tar);
  const start = firstFileHeaderOffset(patched);
  const header = patched.subarray(start, start + BLOCK_SIZE);
  header.fill(0, NAME_OFFSET, NAME_OFFSET + NAME_LENGTH);
  header.write(path, NAME_OFFSET, 'utf8');
  reseal(header);
  return patched;
}

describe('readTarGz — a well-formed archive from the system tar', () => {
  const dir = fixtureDir([
    { name: 'hermes', content: 'vm', mode: 0o755 },
    { name: 'notes.txt', content: 'plain', mode: 0o644 },
  ]);
  const entries = readTarGz(systemTarGz(dir, ['hermes', 'notes.txt']));

  it('reads every regular file', () => {
    expect(entries.map((entry) => entry.path).sort()).toEqual(['hermes', 'notes.txt']);
  });

  it('reads the contents back byte for byte', () => {
    expect(entries.find((entry) => entry.path === 'hermes')?.data.toString()).toBe('vm');
    expect(entries.find((entry) => entry.path === 'notes.txt')?.data.toString()).toBe('plain');
  });

  it('preserves the executable bit, which is the whole point for a binary', () => {
    expect(entries.find((entry) => entry.path === 'hermes')?.mode).toBe(0o755);
    expect(entries.find((entry) => entry.path === 'notes.txt')?.mode).toBe(0o644);
  });

  it('survives pax extended headers, which macOS tar always writes', () => {
    // Proven by the archive above parsing at all: bsdtar precedes every entry
    // with an `x` record carrying mtime and xattrs. Assert the shape directly
    // so a regression names the real cause instead of failing obscurely.
    const raw = gunzipSync(systemTarGz(dir, ['hermes']));
    const typeflags: string[] = [];
    for (let offset = 0; offset + BLOCK_SIZE <= raw.length; offset += BLOCK_SIZE) {
      const block = raw.subarray(offset, offset + BLOCK_SIZE);
      if (block.every((byte) => byte === 0)) break;
      typeflags.push(String.fromCharCode(block[TYPEFLAG_OFFSET] as number));
      const size = Number.parseInt(
        raw
          .toString('latin1', offset + 124, offset + 135)
          .replace(/\0/g, ' ')
          .trim() || '0',
        8,
      );
      offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    }

    expect(typeflags).toContain('0');
    expect(readTarGz(systemTarGz(dir, ['hermes']))).toHaveLength(1);
  });

  it('copes with macOS AppleDouble companions without losing the real files', () => {
    const entries = readTarGz(systemTarGz(dir, ['hermes'], true));

    expect(entries.some((entry) => entry.path === 'hermes')).toBe(true);
  });
});

describe('readTarGz — hostile archives', () => {
  const dir = fixtureDir([{ name: 'hermes', content: 'vm', mode: 0o755 }]);
  const valid = gunzipSync(systemTarGz(dir, ['hermes']));

  /**
   * The system tar refuses to write these paths, which is exactly why they have
   * to be assembled by hand: the guard exists for archives that were not built
   * by a cooperative tool.
   */
  it('rejects an entry whose path escapes with ..', () => {
    const archive = retargetFirstEntry(valid, '../../etc/cron.d/pwned');

    expect(() => readTar(archive)).toThrow(TarError);
    expect(() => readTar(archive)).toThrow(/escapes the archive root/);
  });

  it('rejects an entry with a bare .. segment in the middle of a path', () => {
    const archive = retargetFirstEntry(valid, 'bin/../../../pwned');

    expect(() => readTar(archive)).toThrow(/escapes the archive root/);
  });

  it('rejects an absolute path', () => {
    const archive = retargetFirstEntry(valid, '/etc/cron.d/pwned');

    expect(() => readTar(archive)).toThrow(/absolute path/);
  });

  it('rejects a path a pax header rewrote, not just the ustar name', () => {
    // The attack the pax parsing exists to stop: a harmless ustar name with an
    // escaping `path` override in the extended header preceding it.
    const archive = writeTar([{ path: 'hermes', mode: 0o755, data: Buffer.from('vm') }]);
    const record = '30 path=../../../../pwned\n';
    const paxBody = Buffer.alloc(BLOCK_SIZE);
    paxBody.write(record.replace('30 ', `${record.length} `), 0, 'utf8');

    const paxHeader = Buffer.alloc(BLOCK_SIZE);
    paxHeader.write('PaxHeader/hermes', NAME_OFFSET, 'utf8');
    paxHeader.write('0000644\0', 100, 'latin1');
    paxHeader.write(`${record.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
    paxHeader.write('00000000000\0', 136, 'latin1');
    paxHeader.write('x', TYPEFLAG_OFFSET, 'latin1');
    paxHeader.write('ustar\0', 257, 'latin1');
    paxHeader.write('00', 263, 'latin1');
    reseal(paxHeader);

    expect(() => readTar(Buffer.concat([paxHeader, paxBody, archive]))).toThrow(
      /escapes the archive root/,
    );
  });

  it('rejects a symlink, which is not a regular file', () => {
    const linkDir = tempDir();
    writeFileSync(join(linkDir, 'real'), 'x');
    symlinkSync('real', join(linkDir, 'link'));

    expect(() => readTarGz(systemTarGz(linkDir, ['real', 'link']))).toThrow(
      /is a symbolic link; only regular files are accepted/,
    );
  });

  it('rejects a directory entry rather than silently skipping it', () => {
    const treeDir = tempDir();
    mkdirSync(join(treeDir, 'nested'));
    writeFileSync(join(treeDir, 'nested', 'file'), 'x');

    expect(() => readTarGz(systemTarGz(treeDir, ['nested']))).toThrow(/is a directory/);
  });

  it('rejects a truncated archive', () => {
    // Built here rather than by cutting blocks off the system tar's output: how
    // much trailing padding that leaves is implementation-specific (GNU pads to
    // a 20-block factor, bsdtar does not), so a fixed cut removes only zeros on
    // some platforms and the archive stays perfectly valid. Declaring a body and
    // withholding it truncates the entry itself, on every platform.
    const complete = writeTar([
      { path: 'hermes', mode: 0o755, data: Buffer.alloc(BLOCK_SIZE * 2, 7) },
    ]);
    const truncated = complete.subarray(0, BLOCK_SIZE * 2);

    expect(() => readTar(truncated)).toThrow(/truncated/);
  });

  it('rejects an archive cut off mid-entry', () => {
    const entry = writeTar([{ path: 'hermes', mode: 0o755, data: Buffer.alloc(4096, 7) }]);

    expect(() => readTar(entry.subarray(0, BLOCK_SIZE + 1024))).toThrow(/truncated/);
  });

  it('rejects a corrupt header, rather than reading a wild path or size', () => {
    const corrupt = Buffer.from(valid);
    corrupt.write('hermes-tampered', NAME_OFFSET, 'utf8');

    expect(() => readTar(corrupt)).toThrow(/checksum mismatch/);
  });

  it('rejects content hiding after the end-of-archive marker', () => {
    const archive = writeTar([{ path: 'hermes', mode: 0o755, data: Buffer.from('vm') }]);
    archive.write('smuggled', archive.length - 16, 'utf8');

    expect(() => readTar(archive)).toThrow(/after the end-of-archive marker/);
  });

  it('rejects something that is not a tar at all', () => {
    expect(() => readTar(Buffer.alloc(BLOCK_SIZE, 0x41))).toThrow(TarError);
  });

  it('rejects a zero-length buffer, which has no end marker', () => {
    expect(() => readTar(Buffer.alloc(0))).toThrow(/truncated/);
  });

  it('rejects payload that is not gzip', () => {
    expect(() => readTarGz(Buffer.from('definitely not gzip'))).toThrow(/not valid gzip/);
  });

  it('rejects a gzip stream whose payload is not a tar', () => {
    expect(() => readTarGz(gzipSync(Buffer.from('hello')))).toThrow(TarError);
  });
});

describe('readTar — an empty archive', () => {
  it('reads a system-tar archive with no entries as no entries', () => {
    const out = join(tempDir(), 'empty.tar.gz');
    const result = spawnSync('tar', ['-czf', out, '-T', '/dev/null'], { encoding: 'utf8' });
    expect(result.status).toBe(0);

    expect(readTarGz(readFileSync(out))).toEqual([]);
  });

  it('round-trips our own empty archive', () => {
    expect(readTarGz(writeTarGz([]))).toEqual([]);
  });
});

describe('writeTar — round trip', () => {
  const inputs = [
    { path: 'hermes', mode: 0o755, data: Buffer.from('vm bytes') },
    { path: 'hermesc', mode: 0o755, data: Buffer.alloc(3000, 0xab) },
    { path: 'hvm', mode: 0o755, data: Buffer.from('') },
  ];

  it('reads back exactly what was written, modes included', () => {
    expect(readTarGz(writeTarGz(inputs))).toEqual(
      inputs.map((input) => ({ path: input.path, mode: input.mode, data: input.data })),
    );
  });

  it('produces byte-identical archives across runs, so checksums are stable', () => {
    expect(writeTarGz(inputs).equals(writeTarGz(inputs))).toBe(true);
  });

  it('is readable by the system tar, not just by us', () => {
    const dir = tempDir();
    const archive = join(dir, 'ours.tar.gz');
    writeFileSync(archive, writeTarGz(inputs));

    const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    expect(listed.status).toBe(0);
    expect(listed.stdout.split('\n').filter(Boolean).sort()).toEqual(['hermes', 'hermesc', 'hvm']);

    // Extracting with the system tar proves the mode bits are real, not just
    // something our own reader agrees with itself about.
    const out = tempDir();
    expect(spawnSync('tar', ['-xzf', archive, '-C', out], { encoding: 'utf8' }).status).toBe(0);
    expect(readFileSync(join(out, 'hermes')).toString()).toBe('vm bytes');
  });

  it('refuses to write an escaping path', () => {
    expect(() => writeTar([{ path: '../pwned', mode: 0o755, data: Buffer.alloc(0) }])).toThrow(
      TarError,
    );
  });

  it('refuses a path too long for a ustar name field', () => {
    expect(() => writeTar([{ path: 'a'.repeat(101), mode: 0o755, data: Buffer.alloc(0) }])).toThrow(
      /too long for ustar/,
    );
  });
});

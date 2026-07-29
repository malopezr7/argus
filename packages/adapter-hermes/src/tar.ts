/**
 * A minimal, strict ustar codec — the only tar Argus needs.
 *
 * Argus ships Hermes binaries as gzipped tars on GitHub Releases, and has a
 * standing policy of zero runtime dependencies. `node:zlib` handles the gzip
 * layer; the tar layer is 512-byte blocks and is implemented here.
 *
 * The reader is deliberately hostile. An archive arrives over the network, and
 * a tar entry names its own destination path, so an unchecked extractor writes
 * wherever the archive says — the tar-slip class of bug. Every path is
 * validated, only regular files are accepted, and anything unrecognised is an
 * error rather than a skipped entry: an extractor that silently drops what it
 * does not understand produces a half-populated directory that looks complete.
 *
 * The writer exists so the published archives are produced by us rather than by
 * whichever `tar` a CI runner happens to have. That is not fussiness: macOS
 * `bsdtar` writes AppleDouble `._*` companion entries for extended attributes
 * unless `COPYFILE_DISABLE` is set, so shelling out would put junk files in the
 * release on one runner and not the other. Writing the bytes here makes the
 * archive byte-identical on every platform.
 */

import { gunzipSync, gzipSync } from 'node:zlib';

/** Every tar structure is a multiple of this. */
const BLOCK_SIZE = 512;

/** Archives are padded to a whole number of these, as `tar` itself does. */
const RECORD_SIZE = 10_240;

// Header field offsets, from the POSIX ustar layout.
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const MODE_OFFSET = 100;
const MODE_LENGTH = 8;
const UID_OFFSET = 108;
const GID_OFFSET = 116;
const ID_LENGTH = 8;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const MTIME_OFFSET = 136;
const MTIME_LENGTH = 12;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const PREFIX_OFFSET = 345;
const PREFIX_LENGTH = 155;

const MAGIC = 'ustar\0';
const VERSION = '00';

/** Regular file. Historic tars write a NUL here for the same meaning. */
const TYPE_REGULAR = '0';
const TYPE_REGULAR_ALT = '\0';
/** pax extended header — metadata for the entry that follows it. */
const TYPE_PAX_NEXT = 'x';
/** pax global header — metadata for every entry that follows it. */
const TYPE_PAX_GLOBAL = 'g';

/** What each typeflag we refuse actually is, so the error can say so. */
const REFUSED_TYPES: Readonly<Record<string, string>> = {
  '1': 'a hard link',
  '2': 'a symbolic link',
  '3': 'a character device',
  '4': 'a block device',
  '5': 'a directory',
  '6': 'a FIFO',
  '7': 'a contiguous file',
  L: 'a GNU long-name record',
  K: 'a GNU long-link-name record',
};

/** Raised for any malformed, unsupported, or unsafe archive. */
export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarError';
  }
}

/** One regular file read out of an archive. */
export interface TarEntry {
  /** Path as recorded in the archive, already validated as safe to join. */
  path: string;
  /** Permission bits, masked to the low 12. */
  mode: number;
  /** File contents. */
  data: Buffer;
}

/** One regular file to write into an archive. */
export interface TarInput {
  path: string;
  mode: number;
  data: Buffer;
}

/** Blocks `size` bytes occupy, including padding. */
function paddedLength(size: number): number {
  return Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
}

/** Read a NUL/space-terminated string field. */
function readString(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/**
 * Read an octal numeric field.
 *
 * GNU tar encodes values too large for the field in base-256, flagged by the
 * high bit of the first byte. Nothing Argus publishes comes close to needing
 * it, so it is refused rather than half-implemented — a misparsed size would
 * desynchronise the whole block walk.
 */
function readOctal(block: Buffer, offset: number, length: number, field: string): number {
  const raw = block.subarray(offset, offset + length);
  const first = raw[0] ?? 0;
  if ((first & 0x80) !== 0) {
    throw new TarError(`base-256 encoded ${field} field is not supported`);
  }

  const text = raw.toString('latin1').replace(/\0/g, ' ').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new TarError(`${field} field is not octal: ${JSON.stringify(text)}`);
  }
  return Number.parseInt(text, 8);
}

/**
 * The header checksum, computed with the checksum field read as spaces.
 *
 * Checking it is what turns a truncated or corrupted download into a clear
 * error at the first bad block, instead of a nonsensical path or a wild size.
 */
function headerChecksum(block: Buffer): number {
  let sum = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    const inChecksumField = index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + CHECKSUM_LENGTH;
    sum += inChecksumField ? 0x20 : (block[index] as number);
  }
  return sum;
}

/** True when every byte is NUL. A zero header block ends the archive. */
function isAllZero(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if (byte !== 0) return false;
  }
  return true;
}

/**
 * Reject any path that could escape the directory being extracted into.
 *
 * The three ways out are an absolute path, a `..` segment, and a Windows-style
 * separator or drive letter that `posix.join` would treat as an ordinary
 * character while the filesystem would not.
 */
function validatePath(path: string): void {
  if (path === '') throw new TarError('archive entry has an empty path');
  if (path.startsWith('/')) {
    throw new TarError(`archive entry has an absolute path: ${JSON.stringify(path)}`);
  }
  if (path.includes('\\')) {
    throw new TarError(`archive entry path contains a backslash: ${JSON.stringify(path)}`);
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new TarError(`archive entry has a drive-qualified path: ${JSON.stringify(path)}`);
  }
  if (path.split('/').includes('..')) {
    throw new TarError(`archive entry path escapes the archive root: ${JSON.stringify(path)}`);
  }
}

/**
 * Parse pax extended-header records: `<length> <key>=<value>\n`, where length
 * counts the whole record including its own digits and the newline.
 *
 * These are parsed rather than skipped because a pax record can OVERRIDE the
 * path of the entry that follows it. Skipping them would leave a hole in the
 * tar-slip guard: the ustar name could read `hermes` while the pax `path` says
 * `../../../../etc/cron.d/x`, and only the harmless one would ever be checked.
 */
function parsePaxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;

  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) throw new TarError('pax header record has no length separator');

    const lengthText = data.toString('latin1', offset, space);
    if (!/^\d+$/.test(lengthText)) {
      throw new TarError(`pax header record has a non-numeric length: ${lengthText}`);
    }

    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (length <= 0 || end > data.length) {
      throw new TarError(`pax header record length ${length} overruns the header`);
    }

    // The record ends with a newline that is part of the counted length.
    const record = data.toString('utf8', space + 1, end - 1);
    const equals = record.indexOf('=');
    if (equals === -1) throw new TarError('pax header record has no key');

    records.set(record.slice(0, equals), record.slice(equals + 1));
    offset = end;
  }

  return records;
}

/** Overrides a pax header applies to the entry that follows it. */
interface PaxOverrides {
  path?: string;
  size?: number;
}

/** Read the `path` and `size` overrides out of a pax header; ignore the rest. */
function paxOverrides(data: Buffer): PaxOverrides {
  const records = parsePaxRecords(data);
  const overrides: PaxOverrides = {};

  const path = records.get('path');
  if (path !== undefined) overrides.path = path;

  const size = records.get('size');
  if (size !== undefined) {
    if (!/^\d+$/.test(size)) throw new TarError(`pax size record is not numeric: ${size}`);
    overrides.size = Number.parseInt(size, 10);
  }

  return overrides;
}

/**
 * Read every regular file out of an uncompressed tar.
 *
 * Throws `TarError` on anything malformed, unsupported, or unsafe. Returns an
 * empty array for an archive that legitimately holds no entries.
 */
export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let pending: PaxOverrides = {};
  let offset = 0;

  while (true) {
    if (offset + BLOCK_SIZE > archive.length) {
      throw new TarError(
        `archive is truncated: expected a 512-byte header at offset ${offset}, ` +
          `but only ${archive.length - offset} bytes remain`,
      );
    }

    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    offset += BLOCK_SIZE;

    if (isAllZero(header)) {
      // End of archive. Everything after it must be padding; a non-zero byte
      // there means the file is not what it claims to be.
      if (!isAllZero(archive.subarray(offset))) {
        throw new TarError('archive has content after the end-of-archive marker');
      }
      if (pending.path !== undefined || pending.size !== undefined) {
        throw new TarError('archive ends with a pax header describing no entry');
      }
      return entries;
    }

    const expected = readOctal(header, CHECKSUM_OFFSET, CHECKSUM_LENGTH, 'checksum');
    if (headerChecksum(header) !== expected) {
      throw new TarError(
        `archive header checksum mismatch at offset ${offset - BLOCK_SIZE} — ` +
          'the archive is corrupt or is not a tar',
      );
    }

    // POSIX ustar writes "ustar\0" then version "00"; GNU tar writes "ustar "
    // then " \0", so the field has no terminator and reads back with a trailing
    // space. Both are tar, and the fields this reader goes on to use are laid
    // out identically in each, so accept either. Nothing about the archive is
    // trusted because of this check — path and type are still validated per
    // entry below, which is where the actual safety lives.
    const magic = readString(header, MAGIC_OFFSET, MAGIC.length).trimEnd();
    if (magic !== 'ustar') {
      throw new TarError(`unsupported archive format: magic ${JSON.stringify(magic)}`);
    }

    const typeflag = String.fromCharCode(header[TYPEFLAG_OFFSET] as number);
    // A pax `size` record supersedes the ustar field, and it describes the
    // bytes actually stored — so it drives the walk as well as the slice, or
    // every later offset would be wrong.
    const size = pending.size ?? readOctal(header, SIZE_OFFSET, SIZE_LENGTH, 'size');

    if (offset + size > archive.length) {
      throw new TarError(
        `archive is truncated: entry declares ${size} bytes but only ` +
          `${archive.length - offset} remain`,
      );
    }

    const body = archive.subarray(offset, offset + size);
    offset += paddedLength(size);

    if (typeflag === TYPE_PAX_NEXT) {
      pending = paxOverrides(body);
      continue;
    }
    if (typeflag === TYPE_PAX_GLOBAL) {
      // Global headers carry archive-wide defaults, never a per-entry path.
      continue;
    }

    if (typeflag !== TYPE_REGULAR && typeflag !== TYPE_REGULAR_ALT) {
      const what = REFUSED_TYPES[typeflag] ?? `an unrecognised type ${JSON.stringify(typeflag)}`;
      const name = readString(header, NAME_OFFSET, NAME_LENGTH);
      throw new TarError(
        `archive entry ${JSON.stringify(name)} is ${what}; only regular files are accepted`,
      );
    }

    const prefix = readString(header, PREFIX_OFFSET, PREFIX_LENGTH);
    const name = readString(header, NAME_OFFSET, NAME_LENGTH);
    const path = pending.path ?? (prefix === '' ? name : `${prefix}/${name}`);
    validatePath(path);

    entries.push({
      path,
      mode: readOctal(header, MODE_OFFSET, MODE_LENGTH, 'mode') & 0o7777,
      data: Buffer.from(body),
    });
    pending = {};
  }
}

/** Write an octal field, NUL-terminated, the way ustar expects. */
function writeOctal(block: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  block.write(text, offset, 'latin1');
  block[offset + length - 1] = 0;
}

/**
 * Build a header block for one file.
 *
 * Ownership and timestamps are fixed rather than inherited so two runs of the
 * packaging pipeline over the same binaries produce byte-identical archives,
 * which is what makes the published checksum reproducible.
 */
function writeHeader(input: TarInput): Buffer {
  validatePath(input.path);
  if (Buffer.byteLength(input.path, 'utf8') > NAME_LENGTH) {
    throw new TarError(`entry path is too long for ustar: ${JSON.stringify(input.path)}`);
  }

  const header = Buffer.alloc(BLOCK_SIZE);
  header.write(input.path, NAME_OFFSET, 'utf8');
  writeOctal(header, input.mode & 0o7777, MODE_OFFSET, MODE_LENGTH);
  writeOctal(header, 0, UID_OFFSET, ID_LENGTH);
  writeOctal(header, 0, GID_OFFSET, ID_LENGTH);
  writeOctal(header, input.data.length, SIZE_OFFSET, SIZE_LENGTH);
  writeOctal(header, 0, MTIME_OFFSET, MTIME_LENGTH);
  header.write(TYPE_REGULAR, TYPEFLAG_OFFSET, 'latin1');
  header.write(MAGIC, MAGIC_OFFSET, 'latin1');
  header.write(VERSION, MAGIC_OFFSET + MAGIC.length, 'latin1');

  // The checksum is computed over the header with its own field blanked, so it
  // has to be filled with spaces before summing and overwritten afterwards.
  header.fill(0x20, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH);
  const checksum = headerChecksum(header);
  header.write(checksum.toString(8).padStart(6, '0'), CHECKSUM_OFFSET, 'latin1');
  header[CHECKSUM_OFFSET + 6] = 0;
  header[CHECKSUM_OFFSET + 7] = 0x20;

  return header;
}

/** Build an uncompressed tar holding `inputs`, in the order given. */
export function writeTar(inputs: readonly TarInput[]): Buffer {
  const blocks: Buffer[] = [];
  let length = 0;

  for (const input of inputs) {
    const header = writeHeader(input);
    const body = Buffer.alloc(paddedLength(input.data.length));
    input.data.copy(body);
    blocks.push(header, body);
    length += header.length + body.length;
  }

  // Two zero blocks end the archive; the rest pads it to a whole record, which
  // is what every tar implementation expects to read.
  const padded = Math.ceil((length + 2 * BLOCK_SIZE) / RECORD_SIZE) * RECORD_SIZE;
  blocks.push(Buffer.alloc(padded - length));

  return Buffer.concat(blocks);
}

/**
 * Build a gzipped tar holding `inputs`.
 *
 * Reproducible: `writeTar` fixes every timestamp in the payload, and Node's
 * gzip writes a zero MTIME in its header, so the same inputs always produce the
 * same bytes and therefore the same published checksum.
 */
export function writeTarGz(inputs: readonly TarInput[]): Buffer {
  return gzipSync(writeTar(inputs), { level: 9 });
}

/** Read every regular file out of a gzipped tar. */
export function readTarGz(archive: Buffer): TarEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TarError(`archive is not valid gzip: ${detail}`);
  }
  return readTar(tar);
}

import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { RunResult, SnapshotRecord } from '@arguslab/core';

export const SNAPSHOT_HEADER = '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing';

export interface LoadedSnapshotFile {
  path: string;
  entries: Record<string, string>;
  exists: boolean;
}

interface ReconcileInput {
  loaded: LoadedSnapshotFile;
  result: RunResult;
  update: boolean;
}

function emptyEntries(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function owns(record: Record<string, string>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function hasC0(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

function failFormat(detail: string): never {
  throw new Error(`Invalid snapshot file: ${detail}`);
}

function decodeTemplate(source: string, start: number): { value: string; next: number } {
  let value = '';
  let cursor = start;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '`') return { value, next: cursor + 1 };
    if (char !== '\\') {
      value += char;
      cursor++;
      continue;
    }

    const escaped = source[cursor + 1];
    if (escaped === '\\' || escaped === '`') {
      value += escaped;
      cursor += 2;
      continue;
    }
    if (escaped === '$' && source[cursor + 2] === '{') {
      value += '${';
      cursor += 3;
      continue;
    }
    failFormat(`unsupported template escape at byte ${cursor}`);
  }
  return failFormat('unterminated template literal');
}

function skipNewlines(source: string, start: number): number {
  let cursor = start;
  while (source[cursor] === '\n') cursor++;
  return cursor;
}

/** Parse the strict assignment subset Argus itself writes. No eval or module loading. */
export function parseSnapshotFile(source: string): Record<string, string> {
  if (!source.startsWith(SNAPSHOT_HEADER)) return failFormat('missing Jest v1 header');
  let cursor = SNAPSHOT_HEADER.length;
  if (source[cursor] !== '\n') return failFormat('header must end with a line feed');
  cursor = skipNewlines(source, cursor + 1);

  const entries = emptyEntries();
  const prefix = 'exports[`';
  const middle = '] = `';
  while (cursor < source.length) {
    if (!source.startsWith(prefix, cursor)) {
      return failFormat(`expected an exports assignment at byte ${cursor}`);
    }
    const keyToken = decodeTemplate(source, cursor + prefix.length);
    cursor = keyToken.next;
    if (!source.startsWith(middle, cursor)) {
      return failFormat(`expected ] = \` after snapshot key at byte ${cursor}`);
    }
    const valueToken = decodeTemplate(source, cursor + middle.length);
    cursor = valueToken.next;
    if (source[cursor] !== ';') return failFormat(`expected ; at byte ${cursor}`);
    cursor++;
    if (cursor < source.length && source[cursor] !== '\n') {
      return failFormat(`expected a line feed at byte ${cursor}`);
    }
    cursor = skipNewlines(source, cursor);

    if (hasC0(keyToken.value)) return failFormat('snapshot keys cannot contain C0 controls');
    if (owns(entries, keyToken.value)) {
      return failFormat(`duplicate snapshot key ${JSON.stringify(keyToken.value)}`);
    }
    entries[keyToken.value] = valueToken.value;
  }
  return entries;
}

function escapeTemplate(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') out += '\\\\';
    else if (char === '`') out += '\\`';
    else if (char === '$' && value[i + 1] === '{') out += '\\$';
    else out += char;
  }
  return out;
}

function sortKeys(keys: string[]): void {
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    let j = i - 1;
    while (j >= 0 && keys[j] > key) {
      keys[j + 1] = keys[j];
      j--;
    }
    keys[j + 1] = key;
  }
}

/** Byte-stable Jest v1 header plus CommonJS assignment conventions. */
export function formatSnapshotFile(entries: Record<string, string>): string {
  const keys = Object.keys(entries);
  sortKeys(keys);
  let out = `${SNAPSHOT_HEADER}\n`;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (hasC0(key)) throw new Error('Snapshot keys cannot contain C0 control characters');
    out += `\nexports[\`${escapeTemplate(key)}\`] = \`${escapeTemplate(entries[key])}\`;\n`;
  }
  return out;
}

export function snapshotPathFor(testFile: string): string {
  return join(dirname(testFile), '__snapshots__', `${basename(testFile)}.snap`);
}

export async function loadSnapshotFile(testFile: string): Promise<LoadedSnapshotFile> {
  const path = snapshotPathFor(testFile);
  try {
    const source = await readFile(path, 'utf8');
    return { path, entries: parseSnapshotFile(source), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, entries: emptyEntries(), exists: false };
    }
    throw error;
  }
}

function cloneEntries(source: Record<string, string>): Record<string, string> {
  const target = emptyEntries();
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) target[keys[i]] = source[keys[i]];
  return target;
}

async function persist(path: string, entries: Record<string, string>): Promise<void> {
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    await rm(path, { force: true });
    return;
  }

  const directory = dirname(path);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, formatSnapshotFile(entries), 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function obsoleteRecord(key: string, value: string, removed: boolean): SnapshotRecord {
  return {
    key,
    value,
    testPassed: false,
    status: removed ? 'removed' : 'obsolete',
  };
}

/** Compare emitted bytes, persist safe changes, and annotate reporter counts. */
export async function reconcileSnapshotFile(input: ReconcileInput): Promise<void> {
  const { loaded, result, update } = input;
  const finalEntries = cloneEntries(loaded.entries);
  const exercised = new Set<string>();
  let changed = false;

  for (let i = 0; i < result.snap.length; i++) {
    const entry = result.snap[i];
    if (exercised.has(entry.key)) throw new Error(`Duplicate emitted snapshot key: ${entry.key}`);
    exercised.add(entry.key);
    const exists = owns(loaded.entries, entry.key);
    const matches = exists && loaded.entries[entry.key] === entry.value;

    if (!entry.testPassed) {
      entry.status = exists && !matches && !update ? 'failed' : 'discarded';
      continue;
    }
    if (!exists) {
      finalEntries[entry.key] = entry.value;
      entry.status = 'added';
      changed = true;
    } else if (matches) {
      entry.status = 'matched';
    } else if (update) {
      finalEntries[entry.key] = entry.value;
      entry.status = 'updated';
      changed = true;
    } else {
      entry.status = 'failed';
    }
  }

  const safeToPrune = update && result.totals.failed === 0 && !result.snapFiltered;
  const oldKeys = Object.keys(loaded.entries);
  sortKeys(oldKeys);
  for (let i = 0; i < oldKeys.length; i++) {
    const key = oldKeys[i];
    if (exercised.has(key)) continue;
    if (safeToPrune) {
      delete finalEntries[key];
      changed = true;
    }
    result.snap[result.snap.length] = obsoleteRecord(key, loaded.entries[key], safeToPrune);
  }

  if (changed) await persist(loaded.path, finalEntries);
}

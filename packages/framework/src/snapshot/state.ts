import { serializeSnapshot } from './serialize.js';

export type SnapshotInputEntry = readonly [key: string, value: string];

interface SnapshotAttempt {
  key: string;
  value: string;
  passed: boolean;
}

interface CurrentTest {
  name: string;
  firstAttempt: number;
}

interface SnapshotRunFields {
  snap?: string;
  snapFiltered?: boolean;
}

const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectCreate = Object.create;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const numberToString = Number.prototype.toString;

let configured = false;
let updateSnapshots = false;
let hasExpectedEntries = false;
let expected: Record<string, string> = objectCreate(null) as Record<string, string>;
let attempts: SnapshotAttempt[] = [];
let counters: Record<string, number> = objectCreate(null) as Record<string, number>;
let currentTest: CurrentTest | undefined;
let exercised = false;

function owns(record: Record<string, unknown>, key: string): boolean {
  return objectHasOwnProperty.call(record, key);
}

function hasC0(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (stringCharCodeAt.call(value, i) < 0x20) return true;
  }
  return false;
}

function validateKey(key: string): void {
  if (hasC0(key)) {
    throw new Error('snapshot keys cannot contain C0 control characters');
  }
}

/** Configure the file's existing snapshot bytes before user modules evaluate. */
export function configureSnapshots(entries: readonly SnapshotInputEntry[], update: boolean): void {
  if (configured) throw new Error('Snapshots are already configured for this test file');

  const next = objectCreate(null) as Record<string, string>;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = entry[0];
    const value = entry[1];
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('Snapshot configuration entries must be [string, string] pairs');
    }
    validateKey(key);
    if (owns(next, key)) throw new Error(`Duplicate snapshot key: ${key}`);
    next[key] = value;
  }

  configured = true;
  expected = next;
  hasExpectedEntries = entries.length > 0;
  updateSnapshots = update;
}

/** Reset per-run state while retaining the sealed injected configuration. */
export function beginSnapshotRun(): void {
  attempts = [];
  counters = objectCreate(null) as Record<string, number>;
  currentTest = undefined;
  exercised = hasExpectedEntries;
}

export function beginSnapshotTest(fullName: string): void {
  if (currentTest !== undefined) throw new Error('Snapshot test context is already active');
  currentTest = { name: fullName, firstAttempt: attempts.length };
}

export function finishSnapshotTest(passed: boolean): void {
  const current = currentTest;
  if (current === undefined) return;
  for (let i = current.firstAttempt; i < attempts.length; i++) attempts[i].passed = passed;
  currentTest = undefined;
}

function nextKey(hint: string | undefined): string {
  const current = currentTest;
  if (current === undefined) {
    throw new Error('toMatchSnapshot() must be called while a test is running');
  }
  const base = hint === undefined || hint.length === 0 ? current.name : `${current.name}: ${hint}`;
  validateKey(base);
  const count = (owns(counters, base) ? counters[base] : 0) + 1;
  counters[base] = count;
  return `${base} ${count}`;
}

export function matchSnapshot(actual: unknown, hint: unknown, negated: boolean): void {
  if (negated) throw new Error('toMatchSnapshot() does not support .not');
  if (hint !== undefined && typeof hint !== 'string') {
    throw new Error('toMatchSnapshot() hint must be a string');
  }

  exercised = true;
  const key = nextKey(hint as string | undefined);
  const value = serializeSnapshot(actual);
  attempts[attempts.length] = { key, value, passed: false };

  if (updateSnapshots || !owns(expected, key) || expected[key] === value) return;
  throw new Error(
    `Snapshot mismatch for ${key}\n\nExpected:\n${expected[key]}\n\nReceived:\n${value}\n\nRun Argus with -u to update this snapshot.`,
  );
}

function hex4(code: number): string {
  const raw = numberToString.call(code, 16);
  return stringSlice.call(`0000${raw}`, -4);
}

/** JSON string leaf for the additive snapshot fragment on the result channel. */
function wireString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = stringCharCodeAt.call(value, i);
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0d) out += '\\r';
    else if (code < 0x20 || code === 0x2028 || code === 0x2029) {
      out += `\\u${hex4(code)}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? stringCharCodeAt.call(value, i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i++;
      } else {
        out += `\\u${hex4(code)}`;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += `\\u${hex4(code)}`;
    } else {
      out += value[i];
    }
  }
  return `${out}"`;
}

function emitAttempts(): string {
  let out = '[';
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) out += ',';
    const attempt = attempts[i];
    out +=
      `{"key":${wireString(attempt.key)},"value":${wireString(attempt.value)},"passed":` +
      (attempt.passed ? 'true}' : 'false}');
  }
  return `${out}]`;
}

export function finishSnapshotRun(filtered: boolean): SnapshotRunFields {
  if (!exercised) return {};
  if (currentTest !== undefined) throw new Error('Snapshot test context was not finalized');
  return { snap: emitAttempts(), snapFiltered: filtered };
}

/** Node-only harness seam. Real bundles configure once and never call this. */
export function resetSnapshotsForTesting(): void {
  configured = false;
  updateSnapshots = false;
  hasExpectedEntries = false;
  expected = objectCreate(null) as Record<string, string>;
  beginSnapshotRun();
}

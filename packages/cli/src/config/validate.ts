import type { ArgusConfig, ArgusHermesConfig, HermesEngine } from '@arguslab/core';
import { ENGINE_VALUES } from '@arguslab/core';

/**
 * Checking a config value before anything acts on it.
 *
 * The rule here is VALIDATE, NEVER COERCE. A config file is written once and
 * read on every run, so a wrong value that is quietly repaired — `timeout:
 * 'soon'` becoming the default — produces a suite that has never used the
 * setting its author believes is in effect, and nothing ever says so. Every
 * rejection therefore names the key, what was expected, and what arrived.
 *
 * All problems are collected before throwing. Fixing a config one error per run
 * is a waste of the user's time when the whole object is already in hand.
 */

/** A config that could not be used. `cli.ts` prints the message and exits 2. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Every key `ArgusConfig` accepts, used to validate, to explain a typo, and —
 * in `test/packaging.test.ts` — to prove the published declarations describe
 * the same set of options this validator enforces.
 */
export const CONFIG_KEYS: readonly string[] = [
  'include',
  'exclude',
  'root',
  'timeout',
  'concurrency',
  'hermes',
];

/** Every key `hermes` accepts. */
export const HERMES_CONFIG_KEYS: readonly string[] = ['path', 'engine', 'provision'];

/** Renders a received value compactly enough to sit inside one line. */
function describe(value: unknown): string {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (typeof value === 'function') return '(function)';
  try {
    const rendered = JSON.stringify(value);
    return rendered === undefined ? String(value) : `${rendered} (${type})`;
  } catch {
    return `(${type})`;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accumulates problems so one run reports all of them. */
class Issues {
  readonly messages: string[] = [];

  add(key: string, expected: string, received: unknown): void {
    this.messages.push(`  "${key}" must be ${expected}, but received ${describe(received)}.`);
  }

  unknown(key: string, accepted: readonly string[]): void {
    this.messages.push(`  "${key}" is not a known option. Accepted: ${accepted.join(', ')}.`);
  }
}

/**
 * True for a value that can be a count or a duration.
 *
 * Fractions and non-finite numbers are rejected rather than rounded: a
 * `concurrency` of 2.5 has no meaning, and silently making it 2 or 3 hides that
 * the author asked for something impossible.
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Validates one glob list, reporting the offending index rather than the list. */
function readGlobs(raw: unknown, key: string, issues: Issues): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    issues.add(key, 'an array of strings', raw);
    return undefined;
  }

  let ok = true;
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i];
    if (typeof entry !== 'string' || entry.length === 0) {
      issues.add(`${key}[${i}]`, 'a non-empty string', entry);
      ok = false;
    }
  }
  return ok ? (raw as string[]) : undefined;
}

/** Validates the `hermes` block. Absent and `{}` are both fine. */
function readHermes(raw: unknown, issues: Issues): ArgusHermesConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    issues.add('hermes', 'an object', raw);
    return undefined;
  }

  for (const key of Object.keys(raw)) {
    if (!HERMES_CONFIG_KEYS.includes(key)) issues.unknown(`hermes.${key}`, HERMES_CONFIG_KEYS);
  }

  const hermes: ArgusHermesConfig = {};

  if (raw.path !== undefined) {
    if (typeof raw.path === 'string' && raw.path.length > 0) hermes.path = raw.path;
    else issues.add('hermes.path', 'a non-empty string path to a Hermes binary', raw.path);
  }

  if (raw.engine !== undefined) {
    if (ENGINE_VALUES.includes(raw.engine as HermesEngine)) {
      hermes.engine = raw.engine as HermesEngine;
    } else {
      issues.add('hermes.engine', `one of: ${ENGINE_VALUES.join(', ')}`, raw.engine);
    }
  }

  if (raw.provision !== undefined) {
    if (typeof raw.provision === 'boolean') hermes.provision = raw.provision;
    else issues.add('hermes.provision', 'a boolean', raw.provision);
  }

  return hermes;
}

/**
 * Check an untrusted value against the `ArgusConfig` contract.
 *
 * `source` names where the value came from — a config file path, or a
 * package.json — so the message points at the file to edit.
 *
 * @throws {ConfigError} when anything about the value is wrong.
 */
export function validateConfig(value: unknown, source: string): ArgusConfig {
  if (!isPlainObject(value)) {
    throw new ConfigError(
      `Invalid Argus config in ${source}:\n` +
        `  the config must export an object, but received ${describe(value)}.`,
    );
  }

  const issues = new Issues();
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.includes(key)) issues.unknown(key, CONFIG_KEYS);
  }

  const config: ArgusConfig = {};

  const include = readGlobs(value.include, 'include', issues);
  if (include !== undefined) config.include = include;

  const exclude = readGlobs(value.exclude, 'exclude', issues);
  if (exclude !== undefined) config.exclude = exclude;

  if (value.root !== undefined) {
    if (typeof value.root === 'string' && value.root.length > 0) config.root = value.root;
    else issues.add('root', 'a non-empty directory path', value.root);
  }

  if (value.timeout !== undefined) {
    if (isPositiveInteger(value.timeout)) config.timeout = value.timeout;
    else issues.add('timeout', 'a positive integer number of milliseconds', value.timeout);
  }

  if (value.concurrency !== undefined) {
    if (isPositiveInteger(value.concurrency)) config.concurrency = value.concurrency;
    else
      issues.add(
        'concurrency',
        'a positive integer (1 runs files sequentially)',
        value.concurrency,
      );
  }

  const hermes = readHermes(value.hermes, issues);
  if (hermes !== undefined) config.hermes = hermes;

  if (issues.messages.length > 0) {
    throw new ConfigError(`Invalid Argus config in ${source}:\n${issues.messages.join('\n')}`);
  }

  return config;
}

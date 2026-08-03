import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeLoadFailure, loadConfig } from '../config/load.js';
import { ConfigError } from '../config/validate.js';

/** Runs the loader and returns the message, failing loudly if it succeeded. */
async function rejectionMessage(options: Parameters<typeof loadConfig>[0]): Promise<string> {
  try {
    await loadConfig(options);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error('expected loadConfig to reject, but it resolved');
}

describe('loadConfig', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'argus-config-'));
    // A package.json stops the upward walk, so a stray config above the
    // temporary directory can never leak into these assertions.
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'fixture' }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('falls back to defaults when there is no config at all', async () => {
    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.config).toEqual({});
    expect(loaded.source).toBeUndefined();
    expect(loaded.baseDir).toBe(tmp);
  });

  it('loads a TypeScript config through its default export', async () => {
    const path = join(tmp, 'argus.config.ts');
    writeFileSync(path, `export default { timeout: 4321, include: ['a/**/*.test.ts'] };\n`);

    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.config).toEqual({ timeout: 4321, include: ['a/**/*.test.ts'] });
    expect(loaded.source).toBe(path);
  });

  it('loads a JavaScript config', async () => {
    const path = join(tmp, 'argus.config.js');
    writeFileSync(path, `export default { concurrency: 2 };\n`);

    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.config).toEqual({ concurrency: 2 });
    expect(loaded.source).toBe(path);
  });

  /**
   * `baseDir` is the config file's own directory, not the working directory,
   * so a relative `root` and the default discovery root mean the same thing
   * wherever `argus` happens to be invoked from.
   */
  it('bases relative paths on the config file directory, not the start directory', async () => {
    const nested = join(tmp, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(tmp, 'argus.config.ts'), 'export default { timeout: 1 };\n');

    const loaded = await loadConfig({ startDir: nested });

    expect(loaded.baseDir).toBe(tmp);
  });

  /**
   * `.config/` holds configuration; the project it configures is one level up.
   * Rooting discovery inside `.config/` finds no tests at all.
   */
  it('roots a .config/argus.config.ts at the project, not at .config', async () => {
    mkdirSync(join(tmp, '.config'), { recursive: true });
    writeFileSync(join(tmp, '.config', 'argus.config.ts'), 'export default { timeout: 1 };\n');

    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.source).toBe(join(tmp, '.config', 'argus.config.ts'));
    expect(loaded.baseDir).toBe(tmp);
  });

  it('reads the argus field out of package.json', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'fixture', argus: { timeout: 777 } }),
    );

    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.config).toEqual({ timeout: 777 });
    expect(loaded.source).toBe(join(tmp, 'package.json'));
  });

  it('uses defaults when package.json carries no argus field', async () => {
    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.config).toEqual({});
    expect(loaded.source).toBeUndefined();
  });

  /**
   * Finding a package.json with no `argus` field means no config was found at
   * all, so the discovery root stays where the user is. Moving it up to the
   * nearest package.json would make `argus` in one package of a monorepo
   * quietly run every package.
   */
  it('leaves the base directory at the start directory when no config is found', async () => {
    const nested = join(tmp, 'packages', 'app');
    mkdirSync(nested, { recursive: true });

    const loaded = await loadConfig({ startDir: nested });

    expect(loaded.baseDir).toBe(nested);
  });

  it('lets a config file win over the argus field in the same directory', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'fixture', argus: { timeout: 777 } }),
    );
    writeFileSync(join(tmp, 'argus.config.ts'), 'export default { timeout: 111 };\n');

    const loaded = await loadConfig({ startDir: tmp });

    expect(loaded.config).toEqual({ timeout: 111 });
  });

  it('validates what the file exported', async () => {
    writeFileSync(join(tmp, 'argus.config.ts'), `export default { timeout: 'soon' };\n`);

    const message = await rejectionMessage({ startDir: tmp });

    expect(message).toContain('"timeout"');
    expect(message).toContain('positive integer');
  });

  it('validates the package.json field too', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'fixture', argus: { concurrency: 0 } }),
    );

    expect(await rejectionMessage({ startDir: tmp })).toContain('"concurrency"');
  });

  it('rejects a config file with no default export', async () => {
    writeFileSync(join(tmp, 'argus.config.ts'), 'export const config = { timeout: 1 };\n');

    const message = await rejectionMessage({ startDir: tmp });

    expect(message).toContain('default export');
    expect(message).toContain('argus.config.ts');
  });

  it('surfaces a throw from inside the config file, naming the file', async () => {
    writeFileSync(join(tmp, 'argus.config.ts'), `throw new Error('boom from config');\n`);

    const message = await rejectionMessage({ startDir: tmp });

    expect(message).toContain('argus.config.ts');
    expect(message).toContain('boom from config');
  });

  it('reports unparseable JSON in package.json rather than crashing', async () => {
    writeFileSync(join(tmp, 'package.json'), '{ not json');

    expect(await rejectionMessage({ startDir: tmp })).toContain('package.json');
  });
});

describe('loadConfig — the --config flag', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'argus-config-flag-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'fixture' }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads the named file, whatever it is called', async () => {
    const path = join(tmp, 'custom.ts');
    writeFileSync(path, 'export default { timeout: 999 };\n');

    const loaded = await loadConfig({ startDir: tmp, explicitPath: path });

    expect(loaded.config).toEqual({ timeout: 999 });
    expect(loaded.source).toBe(path);
  });

  /**
   * A named file that is not there is a typo, never a reason to fall back:
   * running with defaults would silently ignore the settings the user just
   * pointed at.
   */
  it('fails naming the path when the named file is missing', async () => {
    const missing = join(tmp, 'nope.config.ts');

    const message = await rejectionMessage({ startDir: tmp, explicitPath: missing });

    expect(message).toContain(missing);
    expect(message).toContain('--config');
  });

  it('beats a config file that would otherwise be discovered', async () => {
    writeFileSync(join(tmp, 'argus.config.ts'), 'export default { timeout: 111 };\n');
    const explicit = join(tmp, 'other.ts');
    writeFileSync(explicit, 'export default { timeout: 222 };\n');

    const loaded = await loadConfig({ startDir: tmp, explicitPath: explicit });

    expect(loaded.config).toEqual({ timeout: 222 });
  });
});

/**
 * Node's native type stripping cannot handle `enum` or `namespace`, and says so
 * with a message that gives the user no idea why a perfectly valid TypeScript
 * file was refused. The explanation is built from the error CODE, which is
 * stable, rather than the wording, which is not.
 *
 * This is unit-tested rather than reproduced live because a `.ts` import inside
 * Vitest is transformed by Vite, which supports both constructs — the failure
 * only exists on the plain-Node path a real install uses.
 */
describe('describeLoadFailure', () => {
  const path = '/repo/argus.config.ts';

  function stripOnlyError(message: string): Error {
    return Object.assign(new SyntaxError(message), {
      code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
    });
  }

  it('explains that enum and namespace cannot be stripped', () => {
    const message = describeLoadFailure(
      path,
      stripOnlyError('TypeScript enum is not supported in strip-only mode'),
    );

    expect(message).toContain(path);
    expect(message).toContain('enum');
    expect(message).toContain('namespace');
    expect(message).toContain('type stripping');
  });

  it('points at a .js config as the way out', () => {
    const message = describeLoadFailure(path, stripOnlyError('TypeScript enum is not supported'));

    expect(message).toContain('argus.config.js');
  });

  it('keeps the original message so the real cause is not hidden', () => {
    const message = describeLoadFailure(
      path,
      stripOnlyError('TypeScript namespace declaration is not supported in strip-only mode'),
    );

    expect(message).toContain('strip-only mode');
  });

  it('passes an ordinary failure through, naming the file', () => {
    const message = describeLoadFailure(path, new Error('boom from config'));

    expect(message).toContain(path);
    expect(message).toContain('boom from config');
    expect(message).not.toContain('type stripping');
  });
});

/**
 * The floor under the CommonJS fallback.
 *
 * The fallback in `esm-fallback.ts` loads these configs rather than explaining
 * them, so this message is only reached when the hook could not be installed
 * at all. It still has to be complete, because it is the last thing standing
 * between the user and Node's bare "Cannot use import statement outside a
 * module" — which names no fix, and which Node's own follow-up advice answers
 * with two options while omitting the one that suits a TypeScript config.
 */
describe('describeLoadFailure — an ES module config in a CommonJS project', () => {
  const path = '/repo/argus.config.ts';

  /** Exactly what Node throws: a bare SyntaxError, carrying no code. */
  function esmInCommonJs(message: string): Error {
    const error = new SyntaxError(message);
    error.stack =
      `${path}:1\nimport './helper.js';\n^^^^^^\n\n` +
      `SyntaxError: ${message}\n    at wrapSafe (node:internal/modules/cjs/loader:1:1)`;
    return error;
  }

  it('names all three ways out', () => {
    const message = describeLoadFailure(
      path,
      esmInCommonJs('Cannot use import statement outside a module'),
    );

    expect(message).toContain('argus.config.mts');
    expect(message).toContain('"type": "module"');
    expect(message).toContain('argus.config.mjs');
  });

  it('says why the file could not be loaded', () => {
    const message = describeLoadFailure(
      path,
      esmInCommonJs('Cannot use import statement outside a module'),
    );

    expect(message).toContain('CommonJS');
    expect(message).toContain(path);
  });

  it('keeps the original message rather than replacing it', () => {
    const message = describeLoadFailure(path, esmInCommonJs("Unexpected token 'export'"));

    expect(message).toContain("Unexpected token 'export'");
  });

  it('recognises the failure however the file happened to trip it', () => {
    for (const raw of [
      'Cannot use import statement outside a module',
      "Unexpected token 'export'",
      'await is only valid in async functions and the top level bodies of modules',
      "Cannot use 'import.meta' outside a module",
    ]) {
      expect(describeLoadFailure(path, esmInCommonJs(raw))).toContain('argus.config.mts');
    }
  });

  /**
   * A config with an ordinary typo is not a module-format problem, and telling
   * its author to rename the file would send them somewhere useless.
   */
  it('stays quiet about module formats for an unrelated syntax error', () => {
    const message = describeLoadFailure(path, esmInCommonJs('Unexpected end of input'));

    expect(message).toContain('Unexpected end of input');
    expect(message).not.toContain('argus.config.mts');
  });
});

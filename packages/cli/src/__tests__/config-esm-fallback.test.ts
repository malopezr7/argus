import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  esmEquivalentFormat,
  esmFallbackEnabled,
  isEsmSyntaxError,
  retryUrl,
} from '../config/esm-fallback.js';

/**
 * The rule the resolve hook applies, tested as the pure function it is.
 *
 * `commonjs-typescript` is Node's format for a `.ts` file governed by a
 * package.json that says `"type": "commonjs"` — the exact shape `npm init -y`
 * writes. Mapping it to `module-typescript` hands the file back to Node's own
 * ES module path, types and all, which is why no transpiler appears anywhere
 * in this feature.
 */
describe('esmEquivalentFormat', () => {
  const file = 'file:///project/argus.config.ts';

  it('maps a CommonJS TypeScript file to its ES module format', () => {
    expect(esmEquivalentFormat(file, 'commonjs-typescript')).toBe('module-typescript');
  });

  it('maps a CommonJS JavaScript file to its ES module format', () => {
    expect(esmEquivalentFormat('file:///project/argus.config.js', 'commonjs')).toBe('module');
  });

  it('leaves an explicitly CommonJS file alone', () => {
    expect(esmEquivalentFormat('file:///project/helper.cjs', 'commonjs')).toBeUndefined();
    expect(
      esmEquivalentFormat('file:///project/helper.cts', 'commonjs-typescript'),
    ).toBeUndefined();
  });

  it('leaves a file Node already reads as an ES module alone', () => {
    expect(esmEquivalentFormat(file, 'module-typescript')).toBeUndefined();
    expect(esmEquivalentFormat(file, 'module')).toBeUndefined();
  });

  it('tolerates a resolver that reported no format at all', () => {
    expect(esmEquivalentFormat(file, undefined)).toBeUndefined();
    expect(esmEquivalentFormat(file, null)).toBeUndefined();
  });

  /**
   * A dependency that ships CommonJS means it, and its package.json says so
   * deliberately rather than because a scaffolder guessed. Reinterpreting it
   * would break `import x from 'some-cjs-pkg'` in a config that works today.
   */
  it('refuses to reinterpret anything inside node_modules', () => {
    expect(
      esmEquivalentFormat('file:///project/node_modules/cjs-pkg/index.js', 'commonjs'),
    ).toBeUndefined();
  });

  it('ignores non-file URLs', () => {
    expect(esmEquivalentFormat('data:text/javascript,0', 'commonjs')).toBeUndefined();
    expect(esmEquivalentFormat('node:fs', 'commonjs')).toBeUndefined();
  });
});

/**
 * The four ways V8 refuses ES module syntax inside a CommonJS script, measured
 * on Node 26. None of them carries an error `code`, so the family can only be
 * recognised by wording. The source prefix in a parser-generated stack is the
 * second half of the gate: a runtime SyntaxError starts with its error header,
 * even when its message copies one of these strings.
 */
describe('isEsmSyntaxError', () => {
  const syntaxError = (message: string): Error => {
    const error = new SyntaxError(message);
    error.stack =
      `/project/argus.config.ts:1\nimport './helper.js';\n^^^^^^\n\n` +
      `SyntaxError: ${message}\n    at wrapSafe (node:internal/modules/cjs/loader:1:1)`;
    return error;
  };

  it.each([
    'Cannot use import statement outside a module',
    "Unexpected token 'export'",
    'await is only valid in async functions and the top level bodies of modules',
    "Cannot use 'import.meta' outside a module",
  ])('recognises %j', (message) => {
    expect(isEsmSyntaxError(syntaxError(message))).toBe(true);
  });

  it('does not claim an ordinary syntax error is a module-format problem', () => {
    expect(isEsmSyntaxError(syntaxError('Unexpected end of input'))).toBe(false);
  });

  it('does not trust module-format wording from a runtime SyntaxError', () => {
    expect(isEsmSyntaxError(new SyntaxError('Cannot use import statement outside a module'))).toBe(
      false,
    );
  });

  it('does not claim a thrown config is a module-format problem', () => {
    expect(isEsmSyntaxError(new Error('boom from config'))).toBe(false);
  });

  it('survives a non-error being thrown', () => {
    expect(isEsmSyntaxError('nope')).toBe(false);
    expect(isEsmSyntaxError(undefined)).toBe(false);
  });
});

/**
 * A failed ES module import is CACHED by the loader: importing the same URL a
 * second time replays the original rejection rather than re-running it. The
 * retry therefore has to ask for a URL the loader has not seen, which is what
 * the query is for.
 */
describe('retryUrl', () => {
  it('produces a URL the module cache has not already failed', () => {
    const first = retryUrl('/project/argus.config.ts');

    expect(first).toMatch(/^file:\/\//);
    expect(first).toContain('argus.config.ts');
    expect(first).toContain('?');
  });

  it('keeps the path intact so relative imports still resolve', () => {
    expect(retryUrl('/project/nested/argus.config.ts')).toContain('/project/nested/');
  });
});

describe('esmFallbackEnabled', () => {
  /**
   * The hook is a process-wide mutation, so a project that never needed it
   * must never acquire it. Nothing in this suite loads a config, so nothing
   * here should have installed anything.
   */
  it('reports no hook installed until something actually needs one', () => {
    expect(esmFallbackEnabled()).toBe(false);
  });
});

/**
 * The mechanism itself, on real Node.
 *
 * This CANNOT be asserted in-process: Vitest serves `.ts` through Vite, which
 * transpiles every import and so never reaches the native loader where the
 * failure lives. A subprocess is the only place the bug exists, so the module
 * under test is imported from source by a plain `node`, against a fixture whose
 * package.json says `"type": "commonjs"` exactly as `npm init -y` writes it.
 *
 * `esm-fallback.ts` imports nothing but `node:` builtins precisely so that this
 * is possible — the real module is exercised, never a copy of its logic.
 */
describe('the fallback on real Node', () => {
  const MODULE = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'config',
    'esm-fallback.ts',
  );

  /** Same ceiling as the other subprocess suites: a failure budget, not a delay. */
  const SUBPROCESS_TIMEOUT_MS = 30_000;

  interface Fixture {
    /** Contents of the config file. */
    config: string;
    /** Extra files, by relative path. */
    files?: Record<string, string>;
    /** package.json "type". `npm init -y` writes "commonjs". */
    type?: string;
    /** Config extension. `.mts` reaches the native ESM loader on the first attempt. */
    extension?: 'ts' | 'mts';
    /** Statements the plain-Node driver runs after the config import settles. */
    afterLoad?: string;
  }

  /**
   * Load a config in a fresh Node process the way `load.ts` does: import it,
   * and on a CommonJS module-format SyntaxError import it as ESM.
   */
  function loadInRealNode(fixture: Fixture): { status: number; stdout: string; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), 'argus-esm-fallback-'));
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', type: fixture.type ?? 'commonjs' }),
      );
      const configPath = join(dir, `argus.config.${fixture.extension ?? 'ts'}`);
      writeFileSync(configPath, fixture.config);

      for (const [relative, contents] of Object.entries(fixture.files ?? {})) {
        const target = join(dir, relative);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
      }

      const driver = join(dir, 'driver.mjs');
      writeFileSync(
        driver,
        `import { esmFallbackEnabled, importConfigSource } from ${JSON.stringify(MODULE)};

const loaded = await importConfigSource(${JSON.stringify(configPath)});
console.log('RESULT:' + JSON.stringify(loaded.default));
console.log('FELL-BACK:' + esmFallbackEnabled());
${fixture.afterLoad ?? ''}
`,
      );

      const run = spawnSync(process.execPath, [driver], { cwd: dir, encoding: 'utf8' });
      return { status: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it(
    'loads an ES module config out of a CommonJS project',
    () => {
      const run = loadInRealNode({
        config: "export default { timeout: 4321, include: ['src/**/*.test.ts'] };\n",
      });

      expect(run.stdout).toContain('RESULT:{"timeout":4321,"include":["src/**/*.test.ts"]}');
      expect(run.status).toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'strips the types on the way, with no transpiler involved',
    () => {
      const run = loadInRealNode({
        config:
          'interface Options { timeout: number }\n' +
          'const options: Options = { timeout: 1234 };\n' +
          'export default options satisfies Options;\n',
      });

      expect(run.stdout).toContain('RESULT:{"timeout":1234}');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'follows a relative TypeScript import out of the config',
    () => {
      const run = loadInRealNode({
        config: "import { TIMEOUT } from './shared.ts';\nexport default { timeout: TIMEOUT };\n",
        files: { 'shared.ts': 'export const TIMEOUT: number = 555;\n' },
      });

      expect(run.stdout).toContain('RESULT:{"timeout":555}');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  /**
   * The reason the hook refuses node_modules. A config importing a CommonJS
   * dependency has to keep working, and it only does if that dependency is
   * still read as CommonJS.
   */
  it(
    'leaves a CommonJS dependency readable by the config that imports it',
    () => {
      const run = loadInRealNode({
        config: "import pkg from 'cjs-pkg';\nexport default { timeout: pkg.timeout };\n",
        files: {
          'node_modules/cjs-pkg/package.json': JSON.stringify({
            name: 'cjs-pkg',
            main: 'index.js',
          }),
          'node_modules/cjs-pkg/index.js': 'module.exports = { timeout: 808 };\n',
        },
      });

      expect(run.stdout).toContain('RESULT:{"timeout":808}');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'leaves an explicitly CommonJS file beside the config readable through default interop',
    () => {
      const run = loadInRealNode({
        config:
          "import helper from './helper.cjs';\n" + 'export default { timeout: helper.timeout };\n',
        files: { 'helper.cjs': 'module.exports = { timeout: 30000 };\n' },
      });

      expect(run.stdout).toContain('RESULT:{"timeout":30000}');
      expect(run.status).toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'does not reinterpret an unrelated CommonJS file after loading the config',
    () => {
      const run = loadInRealNode({
        config: 'export default { timeout: 1 };\n',
        files: { 'later.cjs': 'module.exports = { value: 7 };\n' },
        afterLoad:
          "const later = await import('./later.cjs');\n" +
          "console.log('LATER:' + JSON.stringify(later.default));",
      });

      expect(run.stdout).toContain('LATER:{"value":7}');
      expect(run.stdout).toContain('FELL-BACK:false');
      expect(run.status).toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  /**
   * The case that must NOT change. A config written as CommonJS loads on the
   * first attempt today, and the fallback is never reached — so it cannot
   * possibly break it.
   */
  it(
    'still loads a CommonJS config without ever reaching the fallback',
    () => {
      const run = loadInRealNode({
        config: 'const timeout: number = 99;\nmodule.exports = { timeout };\n',
      });

      expect(run.stdout).toContain('RESULT:{"timeout":99}');
      expect(run.stdout).toContain('FELL-BACK:false');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'leaves an ES module project working, with no hook installed at all',
    () => {
      const run = loadInRealNode({
        type: 'module',
        config: 'export default { timeout: 42 };\n',
      });

      expect(run.stdout).toContain('RESULT:{"timeout":42}');
      expect(run.stdout).toContain('FELL-BACK:false');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  /**
   * A config that throws must keep reporting what it threw. The fallback only
   * ever engages on a SyntaxError, so a runtime failure never reaches it and
   * the original message survives intact.
   */
  it(
    'passes a throwing config straight through',
    () => {
      const run = loadInRealNode({ config: "throw new Error('boom from config');\n" });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('boom from config');
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'does not retry a config that throws a runtime SyntaxError',
    () => {
      const run = loadInRealNode({
        config:
          "console.log('CONFIG-BODY-RAN');\n" +
          "JSON.parse('{oops');\n" +
          'module.exports = { timeout: 1 };\n',
      });

      expect(run.stdout.match(/^CONFIG-BODY-RAN$/gm)).toHaveLength(1);
      expect(run.stderr).toContain('SyntaxError');
      expect(run.status).not.toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'does not retry a runtime SyntaxError that copies Node module-format wording',
    () => {
      const run = loadInRealNode({
        config:
          "console.log('LOOKALIKE-BODY-RAN');\n" +
          "throw new SyntaxError('Cannot use import statement outside a module');\n",
      });

      expect(run.stdout.match(/^LOOKALIKE-BODY-RAN$/gm)).toHaveLength(1);
      expect(run.status).not.toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'reports a runtime error from the ES module retry',
    () => {
      const run = loadInRealNode({
        config:
          "throw new Error('REAL_CONFIG_ERROR_MARKER');\n" + 'export default { timeout: 1 };\n',
      });

      expect(run.stderr).toContain('REAL_CONFIG_ERROR_MARKER');
      expect(run.status).not.toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'reports a missing dependency from the ES module retry',
    () => {
      const run = loadInRealNode({
        config: "import './missing-helper.js';\nexport default { timeout: 1 };\n",
      });

      expect(run.stderr).toContain('missing-helper.js');
      expect(run.stderr).toContain('Cannot find module');
      expect(run.status).not.toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  it(
    'keeps a warning listener registered while the config loads',
    () => {
      const run = loadInRealNode({
        extension: 'mts',
        config:
          "process.on('warning', (warning) => console.log('CONFIG-LISTENER:' + warning.message));\n" +
          'export default {};\n',
        afterLoad:
          "process.emitWarning('after-load');\n" +
          'await new Promise((resolve) => setImmediate(resolve));\n' +
          "console.log('WARNING-LISTENERS:' + process.listeners('warning').length);",
      });

      expect(run.stdout).toContain('CONFIG-LISTENER:after-load');
      expect(run.stdout).toContain('WARNING-LISTENERS:2');
      expect(run.status).toBe(0);
    },
    SUBPROCESS_TIMEOUT_MS,
  );

  /**
   * Node prints its own advice on the failed first attempt — "Make sure to set
   * type: module ... or use the .mjs extension" — which names two ways out and
   * omits the one that fits a TypeScript config. Argus is about to load the
   * file anyway, so the warning is not just noise, it is wrong.
   */
  it(
    'does not leave Node telling the user to fix something Argus just handled',
    () => {
      const run = loadInRealNode({ config: 'export default { timeout: 4321 };\n' });

      expect(run.stdout).toContain('RESULT:{"timeout":4321}');
      expect(run.stderr).not.toContain('Failed to load the ES module');
    },
    SUBPROCESS_TIMEOUT_MS,
  );
});

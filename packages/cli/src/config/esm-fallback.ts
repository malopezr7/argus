import {
  type ModuleHooks,
  type ResolveFnOutput,
  type ResolveHookContext,
  registerHooks,
} from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Loading an ES module config out of a CommonJS project.
 *
 * `npm init -y` writes `"type": "commonjs"` into package.json. Node honours
 * that literally, so `argus.config.ts` — the form the README leads with — is
 * read as a CommonJS script, and the first `import` or `export` in it is a
 * syntax error. Node's own advice is to set `"type": "module"` or rename to
 * `.mjs`; it never mentions `.mts`, the one answer that fits a TypeScript
 * config. The result is that Argus's documented setup fails on the default
 * project layout.
 *
 * Node already solves this for itself. When package.json declares no `type`,
 * it detects the syntax and loads the file as whichever it turns out to be.
 * The only reason that does not happen here is the explicit `"commonjs"` a
 * scaffolder wrote on the user's behalf. So Argus applies the same detection
 * to its config's module graph, and to nothing outside it.
 *
 * The mechanism is a resolve hook that rewrites Node's chosen FORMAT — from
 * `commonjs-typescript` to `module-typescript` — and stops there. Node still
 * does the reading, the type stripping and the resolution; no transpiler, no
 * temporary file written into the user's project, no dependency, and nothing
 * routed through the Hermes bundler.
 *
 * Two properties keep this safe:
 *
 *   IT ONLY RUNS AFTER A PARSE FAILURE. A config that loads as CommonJS is
 *   never reinterpreted, so every config that works today still works. And a
 *   CommonJS parse fails BEFORE evaluating anything, so no line of the config
 *   has run when the retry begins — the file is executed exactly once. Trying
 *   the ES module reading first would not have this property: `module.exports`
 *   parses cleanly as ESM and only fails at evaluation, by which point the
 *   config body has already run and would run again on the fallback.
 *
 *   IT IS SCOPED TO ONE IMPORT. The hook follows only the config's descendants,
 *   leaves explicit `.cjs` and `.cts` files and node_modules alone, then removes
 *   itself as soon as the retry settles.
 */

/** Node's format for a file it read as CommonJS, and the ES module counterpart. */
const ESM_EQUIVALENT: Readonly<Record<string, string>> = {
  commonjs: 'module',
  'commonjs-typescript': 'module-typescript',
};

/**
 * Marks the retry import so the module loader treats it as a URL it has not
 * seen. A failed ES module import is CACHED: asking for the same URL again
 * replays the original rejection instead of re-running the load, so without
 * this the retry would fail identically no matter what the hook does.
 *
 * The path is untouched, so relative imports out of the config still resolve,
 * and `fileURLToPath(import.meta.url)` inside the config still yields the
 * config's own path without the query.
 */
const RETRY_MARKER = 'argus-esm-retry';

/**
 * The ways V8 refuses ES module syntax inside a CommonJS script.
 *
 * None of these errors carries a `code`, so unlike the strip-only case in
 * `load.ts` there is nothing stable to match on but the wording. That is why
 * these exact messages gate the retry. A runtime `SyntaxError` is not evidence
 * of a format mismatch: evaluation has already started, so retrying it would
 * execute the config twice.
 */
const ESM_SYNTAX_MARKERS: readonly string[] = [
  'import statement outside a module',
  "Unexpected token 'export'",
  'top level bodies of modules',
  "'import.meta' outside a module",
];

/** The warning Node prints for the attempt this module is about to redo. */
const MODULE_FORMAT_WARNING = 'Failed to load the ES module';

/** What a config module looks like before anything has validated it. */
export interface ConfigNamespace {
  default?: unknown;
}

/**
 * The ES module format for a file Node decided was CommonJS, if it is a file
 * whose format Argus is willing to reconsider at all.
 *
 * Returns `undefined` for everything else, which the hook passes through
 * untouched: files already read as ES modules, explicit `.cjs`/`.cts`, anything
 * under node_modules, and non-file URLs.
 */
export function esmEquivalentFormat(
  url: string,
  format: string | null | undefined,
): string | undefined {
  if (!url.startsWith('file:')) return undefined;
  if (url.includes('/node_modules/')) return undefined;
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('.cjs') || pathname.endsWith('.cts')) return undefined;
  if (typeof format !== 'string') return undefined;
  return ESM_EQUIVALENT[format];
}

/** True when a failure is CommonJS refusing syntax that is really an ES module. */
export function isEsmSyntaxError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) return false;
  // A parser failure's stack starts with the source location and offending
  // line, then the error header. Runtime SyntaxErrors start with that header.
  // The distinction matters: runtime means module evaluation already began.
  if (typeof error.stack !== 'string') return false;
  if (!error.stack.includes(`\n${error.name}: ${error.message}\n`)) return false;
  return ESM_SYNTAX_MARKERS.some((marker) => error.message.includes(marker));
}

/** The URL to re-import a config with, past the loader's cache of its failure. */
export function retryUrl(path: string): string {
  const url = pathToFileURL(path);
  url.searchParams.set(RETRY_MARKER, '1');
  return url.href;
}

let hookInstalled = false;

/**
 * Whether the resolve hook is in place.
 *
 * A hook is a process-wide mutation, so this reports honestly that a project
 * which never needed one never acquired one.
 */
export function esmFallbackEnabled(): boolean {
  return hookInstalled;
}

/** True for the marked config retry rather than an ordinary file URL. */
function isRetryUrl(url: string): boolean {
  return url.startsWith('file:') && new URL(url).searchParams.has(RETRY_MARKER);
}

/** Rewrites formats only inside the marked config's module graph. */
function flipToEsm(
  scopedUrls: Set<string>,
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput,
): ResolveFnOutput {
  const resolved = nextResolve(specifier, context);
  const parentIsScoped = context.parentURL !== undefined && scopedUrls.has(context.parentURL);
  if (!isRetryUrl(resolved.url) && !parentIsScoped) return resolved;

  const format = esmEquivalentFormat(resolved.url, resolved.format);
  if (format !== undefined) {
    scopedUrls.add(resolved.url);
    return { ...resolved, format };
  }

  // Keep following an already-ESM descendant, but do not cross a boundary that
  // explicitly opted into CommonJS or belongs to an installed dependency.
  if (
    resolved.url.startsWith('file:') &&
    !resolved.url.includes('/node_modules/') &&
    !new URL(resolved.url).pathname.match(/\.(?:cjs|cts)$/)
  ) {
    scopedUrls.add(resolved.url);
  }
  return resolved;
}

/**
 * Install a hook for one retry.
 *
 * Returns `undefined` when the runtime has no synchronous hook API, which is the
 * one case where the fallback cannot happen. `load.ts` answers that with an
 * explanation naming every way out by hand, so the user is never left holding
 * Node's message alone.
 */
function enableEsmFallback(): ModuleHooks | undefined {
  if (typeof registerHooks !== 'function') return undefined;

  const scopedUrls = new Set<string>();
  const hooks = registerHooks({
    resolve: (specifier, context, nextResolve) =>
      flipToEsm(scopedUrls, specifier, context, nextResolve),
  });
  hookInstalled = true;
  return hooks;
}

interface HeldImport {
  module?: ConfigNamespace;
  error?: unknown;
  warnings: Error[];
}

/**
 * Import a module while holding on to any warnings it provokes.
 *
 * Node announces the failed CommonJS attempt on stderr, telling the user to
 * set `"type": "module"` or rename to `.mjs`. Once the fallback has loaded the
 * file that advice is not merely noise, it is wrong — it asks for a change
 * that is no longer needed and omits the one that fits. So the warnings are
 * held here rather than printed, and released only once it is clear which of
 * them still stand.
 *
 * Measured on Node 26: the warning is delivered inside the awaited import, so
 * restoring the listeners immediately after it settles is enough to catch it.
 */
async function importHoldingWarnings(url: string): Promise<HeldImport> {
  const saved = process.rawListeners('warning');
  const warnings: Error[] = [];
  const hold = (warning: Error): void => {
    warnings.push(warning);
  };

  for (const listener of saved) process.removeListener('warning', listener);
  process.on('warning', hold);

  try {
    return { module: (await import(url)) as ConfigNamespace, warnings };
  } catch (error) {
    return { error, warnings };
  } finally {
    process.removeListener('warning', hold);
    for (let i = saved.length - 1; i >= 0; i--) {
      process.prependListener('warning', saved[i] as (warning: Error) => void);
    }
  }
}

/** Hand back the warnings that were not about the problem just solved. */
function release(warnings: readonly Error[]): void {
  for (const warning of warnings) process.emitWarning(warning);
}

/**
 * Import a config file, coping with a project that declared itself CommonJS.
 *
 * @throws whatever the import threw. The caller turns it into a `ConfigError`
 * with the file named; this layer only decides WHICH failure is worth
 * reporting when there were two.
 */
export async function importConfigSource(path: string): Promise<ConfigNamespace> {
  const first = await importHoldingWarnings(pathToFileURL(path).href);

  if (first.module !== undefined) {
    release(first.warnings);
    return first.module;
  }

  // Only a CommonJS parser rejecting ES module syntax proves evaluation never
  // began. An arbitrary runtime SyntaxError may have followed side effects.
  if (!isEsmSyntaxError(first.error)) {
    release(first.warnings);
    throw first.error;
  }

  const hooks = enableEsmFallback();
  if (hooks === undefined) {
    release(first.warnings);
    throw first.error;
  }

  release(first.warnings.filter((warning) => !warning.message.includes(MODULE_FORMAT_WARNING)));

  try {
    return (await import(retryUrl(path))) as ConfigNamespace;
  } finally {
    hooks.deregister();
    hookInstalled = false;
  }
}

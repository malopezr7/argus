/**
 * @argus/framework env polyfill.
 *
 * Runs INSIDE Hermes, FIRST in the virtual entry, before framework/user code.
 * Standalone Hermes has only `print`: no `console`, no RN-style `global`. This
 * builds both from `print`. Dependency-free; no Node/Bun APIs.
 */

declare function print(message: string): void;

(() => {
  const g = (
    typeof globalThis !== 'undefined'
      ? globalThis
      : // Fallback for environments without globalThis (should not happen on Hermes).
        Function('return this')()
  ) as Record<string, unknown>;

  // RN-style `global` alias (globalThis exists on Hermes; `global` does not).
  if (typeof g.global === 'undefined') {
    g.global = g;
  }

  // Minimal `console` built from `print`. Joins args with a space like Node.
  if (typeof g.console === 'undefined') {
    const write = (...args: unknown[]): void => {
      print(args.map(String).join(' '));
    };
    g.console = { log: write, info: write, debug: write, warn: write, error: write };
  }
})();

/**
 * @arguslab/framework env polyfill.
 *
 * Runs INSIDE Hermes, FIRST in the virtual entry, before framework/user code.
 * Standalone Hermes has `print` but no `console` or RN-style `global`. This
 * builds both from `print` and supplies the small scheduling primitives React
 * needs. Dependency-free; no Node/Bun APIs.
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

  if (typeof g.queueMicrotask === 'undefined') {
    g.queueMicrotask = (callback: () => void): void => {
      Promise.resolve().then(callback);
    };
  }

  // React 19's async `act` uses MessageChannel to enqueue its final flush task.
  // Standalone Hermes has timers but no MessageChannel, so provide only the two
  // entangled ports React needs. Delivery goes through the engine's timer queue;
  // RNTL bounds that queue separately because Hermes ignores timer delays.
  if (typeof g.MessageChannel === 'undefined') {
    interface Port {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage(value: unknown): void;
    }

    function makePort(): Port {
      return { onmessage: null, postMessage: () => undefined };
    }

    function ArgusMessageChannel(this: { port1: Port; port2: Port }): void {
      const port1 = makePort();
      const port2 = makePort();
      port1.postMessage = function postToPort2(value): void {
        setTimeout(function deliver(): void {
          port2.onmessage?.({ data: value });
        }, 0);
      };
      port2.postMessage = function postToPort1(value): void {
        setTimeout(function deliver(): void {
          port1.onmessage?.({ data: value });
        }, 0);
      };
      this.port1 = port1;
      this.port2 = port2;
    }

    // React resolves MessageChannel lazily after an async act callback settles.
    // Keep that dependency in this pre-user-code closure: assignment remains a
    // harmless no-op, while React always receives the captured constructor.
    Object.defineProperty(g, 'MessageChannel', {
      configurable: false,
      enumerable: true,
      get: () => ArgusMessageChannel,
      set: () => undefined,
    });
  }

  // Minimal `console` built from `print`. Joins args with a space like Node.
  if (typeof g.console === 'undefined') {
    const write = (...args: unknown[]): void => {
      print(args.map(String).join(' '));
    };
    g.console = { log: write, info: write, debug: write, warn: write, error: write };
  }
})();

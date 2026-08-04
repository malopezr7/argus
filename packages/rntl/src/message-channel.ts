/**
 * Component-only MessageChannel polyfill for React 19 async act.
 *
 * The `argus` facade imports this module as a side effect, so esbuild includes it
 * only when a test imports the component API. The module always replaces a
 * configurable ambient constructor before the importing test body, while plain
 * suites retain Hermes' native `undefined` global.
 */

interface Port {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(value: unknown): void;
}

function makePort(): Port {
  return { onmessage: null, postMessage: () => undefined };
}

(() => {
  const g = globalThis as Record<string, unknown>;

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

  // ES modules evaluate once per bundle, so imports already provide idempotency.
  // Never trust an ambient value here: a setup dependency may have installed a
  // writable constructor before `argus` initialized. React resolves the global
  // lazily after an async act callback settles, so replace it unconditionally
  // with this closure-captured constructor and make later assignment a no-op.
  Object.defineProperty(g, 'MessageChannel', {
    configurable: false,
    enumerable: true,
    get: () => ArgusMessageChannel,
    set: () => undefined,
  });
})();

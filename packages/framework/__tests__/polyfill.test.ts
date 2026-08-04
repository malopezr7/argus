import { afterEach, describe, expect, it, vi } from 'vitest';

const originalQueueMicrotask = globalThis.queueMicrotask;
const originalMessageChannel = globalThis.MessageChannel;

afterEach(() => {
  globalThis.queueMicrotask = originalQueueMicrotask;
  globalThis.MessageChannel = originalMessageChannel;
});

describe('Hermes environment polyfill', () => {
  it('installs queueMicrotask using the Promise microtask queue', async () => {
    Reflect.deleteProperty(globalThis, 'queueMicrotask');
    vi.resetModules();

    await import('../src/polyfill.js');

    const order: string[] = [];
    globalThis.queueMicrotask(() => order.push('microtask'));
    order.push('sync');
    await Promise.resolve();
    expect(order).toEqual(['sync', 'microtask']);
  });

  it('does not expose MessageChannel to a plain test environment', async () => {
    Reflect.deleteProperty(globalThis, 'MessageChannel');
    vi.resetModules();

    await import('../src/polyfill.js');

    expect(globalThis.MessageChannel).toBeUndefined();
  });
});

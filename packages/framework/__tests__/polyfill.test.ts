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

  it('installs the MessageChannel task primitive React async act requires', async () => {
    Reflect.deleteProperty(globalThis, 'MessageChannel');
    vi.resetModules();

    await import('../src/polyfill.js');

    const message = await new Promise<unknown>((resolve) => {
      const channel = new globalThis.MessageChannel();
      channel.port1.onmessage = (event) => resolve(event.data);
      channel.port2.postMessage('ready');
    });

    expect(message).toBe('ready');
  });
});

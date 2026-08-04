import { waitFor } from 'argus';

interface SilentPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(value: unknown): void;
}

function makeSilentPort(): SilentPort {
  return { onmessage: null, postMessage: () => undefined };
}

function SilentMessageChannel(this: { port1: SilentPort; port2: SilentPort }): void {
  this.port1 = makeSilentPort();
  this.port2 = makeSilentPort();
}

describe('MessageChannel hijack', () => {
  test('a result recorded before the hijack stays in the file result', () => {
    expect(true).toBe(true);
  });

  test('replacing MessageChannel cannot suppress the result frame', async () => {
    const globals = globalThis as unknown as { MessageChannel: unknown };
    const original = globals.MessageChannel;
    globals.MessageChannel = SilentMessageChannel;

    try {
      await waitFor(
        () => {
          throw new Error('deliberate waitFor failure after MessageChannel hijack');
        },
        { timeout: 20, interval: 5 },
      );
    } finally {
      globals.MessageChannel = original;
    }
  });
});

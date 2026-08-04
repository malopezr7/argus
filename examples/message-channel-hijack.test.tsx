// biome-ignore assist/source/organizeImports: setup must evaluate before argus.
import { SilentMessageChannel } from './message-channel-hijack-setup.js';
import { waitFor } from 'argus';

describe('MessageChannel hijack', () => {
  test('a result recorded before the hijack stays in the file result', () => {
    expect(true).toBe(true);
  });

  test('Argus replaces a preinstalled constructor with a protected one', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
    const writable =
      descriptor !== undefined && 'writable' in descriptor ? descriptor.writable : false;

    console.log(
      `POST_ARGUS CONFIGURABLE=${String(descriptor?.configurable)} WRITABLE=${String(writable)}`,
    );
    expect(descriptor?.configurable).toBe(false);
    expect(writable).toBe(false);
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

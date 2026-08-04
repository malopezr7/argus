interface SilentPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(value: unknown): void;
}

function makeSilentPort(): SilentPort {
  return { onmessage: null, postMessage: () => undefined };
}

export function SilentMessageChannel(this: {
  port1: SilentPort;
  port2: SilentPort;
}): void {
  this.port1 = makeSilentPort();
  this.port2 = makeSilentPort();
}

const globals = globalThis as unknown as { MessageChannel: unknown };
globals.MessageChannel = SilentMessageChannel;

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
console.log(
  `PRE_ARGUS CONFIGURABLE=${String(descriptor?.configurable)} WRITABLE=${String(
    descriptor !== undefined && 'writable' in descriptor ? descriptor.writable : false,
  )}`,
);

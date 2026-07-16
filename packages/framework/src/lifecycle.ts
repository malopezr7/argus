export type InternalAfterEach = () => void | Promise<unknown>;

const internalAfterEachCallbacks: InternalAfterEach[] = [];

export function registerInternalAfterEach(callback: InternalAfterEach): () => void {
  internalAfterEachCallbacks[internalAfterEachCallbacks.length] = callback;
  return function unregister(): void {
    for (let i = 0; i < internalAfterEachCallbacks.length; i++) {
      if (internalAfterEachCallbacks[i] === callback) {
        internalAfterEachCallbacks.splice(i, 1);
        return;
      }
    }
  };
}

export async function runInternalAfterEach(): Promise<Error | undefined> {
  let firstError: Error | undefined;
  for (let i = 0; i < internalAfterEachCallbacks.length; i++) {
    try {
      await internalAfterEachCallbacks[i]();
    } catch (error) {
      if (firstError === undefined) {
        firstError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }
  return firstError;
}

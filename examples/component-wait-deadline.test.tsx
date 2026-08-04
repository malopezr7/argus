import { waitFor } from 'argus';

describe('component wait wall-clock deadline', () => {
  test('a promise result arriving after the deadline is rejected', async () => {
    const startedAt = Date.now();
    let message = '';

    try {
      await waitFor(
        () =>
          Promise.resolve().then(() => {
            while (Date.now() - startedAt < 150) {
              // Deliberately cross the real deadline in a microtask.
            }
            return 'late';
          }),
        { timeout: 100, interval: 50 },
      );
      throw new Error(
        `waitFor resolved after ${Date.now() - startedAt} ms despite a 100 ms wall-clock timeout`,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('wall-clock budget');
  });
});

/**
 * mapPool — bounded async concurrency pool.
 *
 * Runs `worker` over `items` with at most `n` in flight simultaneously.
 * Results are returned in INPUT order regardless of completion order.
 *
 * CONTRACT: `mapPool` does NOT swallow worker rejections. A rejecting worker
 * rejects the whole pool — that is a CALLER bug. Callers MUST make their
 * worker total (i.e. catch internally and resolve a value). See ADR-5.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  n: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(n, items.length));
  let next = 0;

  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++; // atomic claim (single-threaded JS): no two lanes share i
      results[i] = await worker(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: limit }, lane));
  return results;
}

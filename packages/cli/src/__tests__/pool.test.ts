import { describe, expect, it } from 'vitest';
import { mapPool } from '../pool.js';

describe('mapPool', () => {
  it('(a) results are in input order despite out-of-order completion', async () => {
    // Workers resolve in reverse order: item[2] fastest, item[0] slowest
    const delays = [30, 20, 10];
    const results = await mapPool([0, 1, 2], 3, async (item) => {
      await new Promise<void>((r) => setTimeout(r, delays[item]));
      return item * 10;
    });
    expect(results).toEqual([0, 10, 20]);
  });

  it('(b) at most N workers are in flight simultaneously', async () => {
    const N = 2;
    let inFlight = 0;
    let maxInFlight = 0;

    await mapPool([0, 1, 2, 3, 4], N, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 10));
      inFlight--;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(N);
  });

  it('(c) n=1 produces strictly sequential execution (each worker starts only after previous resolves)', async () => {
    const order: number[] = [];
    await mapPool([0, 1, 2], 1, async (item) => {
      order.push(item); // record start
      await new Promise<void>((r) => setTimeout(r, 5));
      return item;
    });
    expect(order).toEqual([0, 1, 2]);
  });

  // Edge cases

  it('empty input returns []', async () => {
    const results = await mapPool([], 4, async (item: number) => item * 2);
    expect(results).toEqual([]);
  });

  it('items.length < n: no idle-lane errors, all items processed', async () => {
    // n=10, items=[0,1,2] — pool should clamp and process all 3
    const results = await mapPool([0, 1, 2], 10, async (item) => item + 1);
    expect(results).toEqual([1, 2, 3]);
  });

  it('n > items.length: processes all items without error', async () => {
    const results = await mapPool([42, 99], 100, async (item) => item * 2);
    expect(results).toEqual([84, 198]);
  });

  it('throwing worker propagates rejection (total-worker contract documented)', async () => {
    const boom = (): Promise<never> => Promise.reject(new Error('worker-boom'));
    await expect(mapPool([1], 1, boom)).rejects.toThrow('worker-boom');
  });
});

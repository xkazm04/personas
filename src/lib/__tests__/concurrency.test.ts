import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../concurrency';

describe('mapWithConcurrency', () => {
  it('never exceeds the requested width of concurrent in-flight calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('preserves input order regardless of completion order', async () => {
    // Deliberately resolve out of order (item 0 is the slowest) — the result
    // array must still reflect input order, not completion order.
    const delays = [30, 10, 20, 5];
    const out = await mapWithConcurrency(delays, 2, (ms) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)),
    );
    expect(out).toEqual(delays);
  });

  it('propagates a rejection from any item', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('handles an empty input array', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('clamps width to the item count when limit exceeds it', async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2], 10, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

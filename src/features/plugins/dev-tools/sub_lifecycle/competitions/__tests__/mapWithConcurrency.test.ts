import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../WinningGeneProfile';

/** A deferred promise so a test can decide exactly when each call resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('mapWithConcurrency', () => {
  it('preserves input order in the result', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('visits every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([...Array(20).keys()], 6, async (n) => { seen.push(n); return n; });
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it('runs more than one call at a time — the serial for-await never did', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<number>());
    let inFlight = 0;
    let peak = 0;

    const run = mapWithConcurrency([0, 1, 2, 3], 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const value = await gates[i]!.promise;
      inFlight--;
      return value;
    });

    // Let the workers start before releasing anything.
    await Promise.resolve();
    expect(peak).toBe(3);

    gates.forEach((g, i) => g.resolve(i));
    await expect(run).resolves.toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([...Array(15).keys()], 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('returns an empty array for no items and starts no workers', async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 6, async (n: number) => { calls++; return n; });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('rejects when a call rejects, exactly as the serial await did', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('detail fetch failed');
        return n;
      }),
    ).rejects.toThrow('detail fetch failed');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createInFlightRegistry } from './inFlight';

const defer = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createInFlightRegistry', () => {
  it('concurrent same-key callers join one flight', async () => {
    const reg = createInFlightRegistry();
    const d = defer<number>();
    const fn = vi.fn(() => d.promise);

    const a = reg.run('k', fn);
    const b = reg.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reg.inFlight('k')).toBe(true);

    d.resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(reg.inFlight('k')).toBe(false);
  });

  it('distinct keys are independent flights', () => {
    const reg = createInFlightRegistry();
    const fn = vi.fn(() => new Promise<void>(() => {}));
    void reg.run('a', fn);
    void reg.run('b', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('removal-on-failure: a lost flight is not cached for later callers', async () => {
    const reg = createInFlightRegistry();
    const boom = defer<number>();
    const first = reg.run('k', () => boom.promise);
    boom.reject(new Error('down'));
    await expect(first).rejects.toThrow('down');
    expect(reg.inFlight('k')).toBe(false);

    // The next caller gets a NEW flight, not the dead one.
    const ok = await reg.run('k', () => Promise.resolve(42));
    expect(ok).toBe(42);
  });

  it("replace starts a fresh flight and repoints the key; the old flight's cleanup cannot evict it", async () => {
    const reg = createInFlightRegistry();
    const stale = defer<string>();
    const fresh = defer<string>();

    const first = reg.run('k', () => stale.promise);
    const second = reg.run('k', () => fresh.promise, 'replace');
    expect(first).not.toBe(second);

    // Old flight settles AFTER being replaced — its finally must not delete
    // the newer entry.
    stale.resolve('stale');
    await first;
    expect(reg.inFlight('k')).toBe(true);

    fresh.resolve('fresh');
    expect(await second).toBe('fresh');
    expect(reg.inFlight('k')).toBe(false);
  });

  it('a joiner after replace joins the REPLACEMENT flight', async () => {
    const reg = createInFlightRegistry();
    const stale = defer<string>();
    const fresh = defer<string>();

    void reg.run('k', () => stale.promise);
    const replacement = reg.run('k', () => fresh.promise, 'replace');
    const joiner = reg.run('k', () => Promise.resolve('never-called'));

    expect(joiner).toBe(replacement);
    fresh.resolve('fresh');
    expect(await joiner).toBe('fresh');
    stale.resolve('stale');
  });
});

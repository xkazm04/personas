import { describe, it, expect, vi, afterEach } from 'vitest';
import { idlePrefetch } from '../idlePrefetch';

type Ric = (cb: () => void, opts?: { timeout: number }) => number;

function installRic(): ReturnType<typeof vi.fn<Ric>> {
  const ric = vi.fn<Ric>((cb) => {
    cb();
    return 1;
  });
  (globalThis as unknown as { requestIdleCallback?: Ric }).requestIdleCallback = ric;
  return ric;
}

describe('idlePrefetch', () => {
  afterEach(() => {
    delete (globalThis as unknown as { requestIdleCallback?: Ric }).requestIdleCallback;
  });

  it('waits up to 5s for an idle slice by default', () => {
    const ric = installRic();
    idlePrefetch([() => Promise.resolve()]);
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
  });

  it('honours a shorter idle deadline for work deferred only to yield priority', () => {
    const ric = installRic();
    idlePrefetch([() => Promise.resolve()], { idleTimeoutMs: 1000 });
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 1000 });
  });

  it('drains sequentially: the next import is scheduled only after the previous settles', async () => {
    const ric = installRic();
    let release: () => void = () => {};
    const first = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const second = vi.fn(() => Promise.resolve());
    idlePrefetch([first, second]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(ric).toHaveBeenCalledTimes(2);
  });
});

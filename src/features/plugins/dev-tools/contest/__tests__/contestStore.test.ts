// The store's refresh semantics: coalesce onto the running fetch, but keep the
// trailing edge, so a `contest-changed` that lands mid-fetch is never answered
// with a read that began before it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from './fixtures';

const api = vi.hoisted(() => ({
  listContests: vi.fn(),
  getContest: vi.fn(),
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(),
}));
vi.mock('@/api/contest', () => api);

import { __resetContestStoreForTests, contestDetailSlots, detailKey, refreshContest } from '../hooks/contestStore';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  __resetContestStoreForTests();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('contestStore refresh', () => {
  it('a refresh asked for during a running fetch runs once more after it and the slot ends on the later read', async () => {
    const first = deferred<ContestDetail>();
    const second = deferred<ContestDetail>();
    api.getContest.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = refreshContest('p1', 'hero-page');
    const b = refreshContest('p1', 'hero-page');
    const c = refreshContest('p1', 'hero-page');
    expect(api.getContest).toHaveBeenCalledTimes(1);

    first.resolve(detailFixture({ summary: summaryFixture({ phase: 'judging' }) }));
    await vi.waitFor(() => expect(api.getContest).toHaveBeenCalledTimes(2));
    second.resolve(detailFixture({ summary: summaryFixture({ phase: 'review' }) }));
    await Promise.all([a, b, c]);

    // Two refreshes during one flight coalesce into exactly ONE trailing fetch.
    expect(api.getContest).toHaveBeenCalledTimes(2);
    expect(contestDetailSlots.get(detailKey('p1', 'hero-page'))?.data?.summary.phase).toBe('review');
  });

  it('a lone refresh fetches exactly once', async () => {
    api.getContest.mockResolvedValue(detailFixture());
    await refreshContest('p1', 'hero-page');
    expect(api.getContest).toHaveBeenCalledTimes(1);
    expect(contestDetailSlots.get(detailKey('p1', 'hero-page'))?.loading).toBe(false);
  });
});

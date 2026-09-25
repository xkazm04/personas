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

import {
  __resetContestStoreForTests,
  contestDetailSlots,
  contestListSlots,
  detailKey,
  refreshContest,
  refreshContests,
  refreshForChange,
} from '../hooks/contestStore';
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
    // Two later events (separate tasks) land while the first read runs.
    await new Promise((r) => setTimeout(r, 0));
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

  it('subscribers of ONE event (the same tick) share one fetch, with no trailing re-read (FE-16)', async () => {
    api.getContest.mockResolvedValue(detailFixture());
    await Promise.all([refreshContest('p1', 'hero-page'), refreshContest('p1', 'hero-page')]);
    expect(api.getContest).toHaveBeenCalledTimes(1);
  });
});

describe('refreshForChange (FE-16)', () => {
  it('a change to a listed contest patches its row from the fresh detail, with no re-list', async () => {
    api.listContests.mockResolvedValue([
      summaryFixture({ contestId: 'older', updatedAtMs: 5 }),
      summaryFixture({ contestId: 'hero-page', phase: 'running', updatedAtMs: 1 }),
    ]);
    await refreshContests();
    api.getContest.mockResolvedValue(detailFixture({ summary: summaryFixture({ phase: 'review', updatedAtMs: 9 }) }));
    await refreshForChange('p1', 'hero-page');
    expect(api.listContests).toHaveBeenCalledTimes(1);
    expect(api.getContest).toHaveBeenCalledTimes(1);
    const rows = contestListSlots.get('all')!.data!;
    expect(rows.map((r) => `${r.contestId}:${r.phase}`)).toEqual(['hero-page:review', 'older:review']);
  });

  it('a change to a contest the list has never seen re-lists', async () => {
    api.listContests.mockResolvedValue([]);
    await refreshContests();
    api.listContests.mockResolvedValue([summaryFixture({ contestId: 'new-one' })]);
    await refreshForChange('p1', 'new-one');
    expect(api.listContests).toHaveBeenCalledTimes(2);
    expect(contestListSlots.get('all')!.data!.map((r) => r.contestId)).toEqual(['new-one']);
  });

  it('a failed detail read falls back to a re-list, so the row is never left stale silently', async () => {
    api.listContests.mockResolvedValue([summaryFixture({ contestId: 'hero-page' })]);
    await refreshContests();
    api.getContest.mockRejectedValue(new Error('boom'));
    await refreshForChange('p1', 'hero-page');
    expect(api.listContests).toHaveBeenCalledTimes(2);
  });
});

// useReviewDraft's two promises (FE-7): a refetch never overwrites a pending
// edit, and saves land in order; plus the feeder's notice projection.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detailFixture, summaryFixture } from './fixtures';

const api = vi.hoisted(() => ({ saveContestReview: vi.fn(async () => null) }));
vi.mock('@/api/contest', () => api);

import { en } from '@/i18n/en';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestReview } from '@/lib/bindings/ContestReview';

import { projectContestNotice } from '../ContestLiveFeeder';
import { useReviewDraft } from '../hooks/useReviewDraft';
import { emptyReview, setBucket, setField, variantReview } from '../model/reviewModel';

afterEach(() => {
  vi.clearAllMocks();
});

const withReview = (review: ContestReview | null): ContestDetail => ({ ...detailFixture(), review });

describe('useReviewDraft', () => {
  it('an older review refetched while an edit is pending never replaces the edit, before or after the save', async () => {
    const saved = emptyReview(detailFixture().variants);
    const { result, rerender } = renderHook(({ d }) => useReviewDraft(d), { initialProps: { d: withReview(saved) } });
    act(() => result.current.apply((r) => setBucket(r, 'A/1', 'winner')));
    // A refetch that began before the edit's save lands now (a new object, older content).
    rerender({ d: withReview(setField(saved, '')) });
    expect(variantReview(result.current.review!, 'A/1').bucket).toBe('winner');
    await act(async () => {
      await result.current.flush();
    });
    expect(api.saveContestReview).toHaveBeenCalledTimes(1);
    expect(result.current.dirty).toBe(false);
    // Still showing the stale detail: the saved edit stays.
    expect(variantReview(result.current.review!, 'A/1').bucket).toBe('winner');
  });

  it('a newer saved review refetched while nothing is pending reseeds the draft', () => {
    const saved = emptyReview(detailFixture().variants);
    const { result, rerender } = renderHook(({ d }) => useReviewDraft(d), { initialProps: { d: withReview(saved) } });
    rerender({ d: withReview(setBucket(saved, 'B/1', 'shortlist')) });
    expect(variantReview(result.current.review!, 'B/1').bucket).toBe('shortlist');
  });
});

describe('projectContestNotice', () => {
  const tx = (tpl: string, vars: Record<string, string | number>) =>
    tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ''));

  it('a ready notice is keyed by the summary version and names the race', () => {
    const summary = summaryFixture({ phase: 'review', updatedAtMs: 42 });
    const m = projectContestNotice({ kind: 'ready', summary }, en, tx, 1000);
    expect(m.id).toBe('contest:p1/hero-page:ready:42');
    expect(m.message).toContain('Hero page');
    expect(m.alert).toBe(false);
  });

  it('a seat-limit notice is an alert naming the seat', () => {
    const summary = summaryFixture({ phase: 'running' });
    const m = projectContestNotice({ kind: 'seat-limit', summary, seat: { seatId: 'b', spec: 'codex:gpt-6-sol@high' } }, en, tx, 7);
    expect(m.id).toBe('contest:p1/hero-page:seat-limit:b:7');
    expect(m.message).toContain('codex:gpt-6-sol@high');
    expect(m.alert).toBe(true);
  });
});

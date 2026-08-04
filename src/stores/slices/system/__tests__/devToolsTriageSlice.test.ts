import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { TriageCounts } from '@/lib/bindings/TriageCounts';

// The slice reaches the backend only through `import * as devApi` — mocking the
// whole module keeps this a pure unit test of the slice's own bookkeeping
// (cross-project argument passing, keyset append, count arithmetic).
vi.mock('@/api/devTools/devTools', () => ({
  triageIdeas: vi.fn(),
  acceptIdea: vi.fn(),
  rejectIdea: vi.fn(),
  deleteTriageIdea: vi.fn(),
  listTriageRules: vi.fn(),
  createTriageRule: vi.fn(),
  updateTriageRule: vi.fn(),
  deleteTriageRule: vi.fn(),
  runTriageRules: vi.fn(),
}));

import * as devApi from '@/api/devTools/devTools';
import { createDevToolsTriageSlice, type DevToolsTriageSlice } from '../devToolsTriageSlice';

const triageIdeasMock = vi.mocked(devApi.triageIdeas);
const acceptIdeaMock = vi.mocked(devApi.acceptIdea);
const deleteIdeaMock = vi.mocked(devApi.deleteTriageIdea);

function idea(over: Partial<DevIdea> = {}): DevIdea {
  return {
    id: 'i1', project_id: 'p1', context_id: null, scan_type: 'idea_scanner',
    category: 'technical', title: 'T', description: null, reasoning: null,
    status: 'pending', effort: null, impact: null, risk: null, priority: null,
    provider: null, model: null, rejection_reason: null, origin: null,
    use_case_id: null, evidence: null, dedup_key: null, verify_state: null,
    verify_checked_at: null, verify_evidence: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...over,
  };
}

function counts(over: Partial<TriageCounts> = {}): TriageCounts {
  return {
    total: 10, pending: 6, accepted: 3, rejected: 1, archived: 0,
    byOrigin: { scanner: 6 }, byCategory: { technical: 10 },
    ...over,
  };
}

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as DevToolsTriageSlice & { ideas: DevIdea[]; error: unknown };
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createDevToolsTriageSlice as any)(set, get, {}), ideas: [], error: null };
  return { get: () => state, set };
}

describe('devToolsTriageSlice — cross-project fetch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('omits projectId and forwards the status/origin/category filters', async () => {
    triageIdeasMock.mockResolvedValue({ ideas: [idea()], cursor: 'c1', hasMore: true, counts: counts() });
    const h = harness();

    await h.get().fetchTriageIdeas(undefined, { status: 'pending', origin: 'sentry_spike', category: 'technical', limit: 100 });

    expect(triageIdeasMock).toHaveBeenCalledWith(undefined, 100, undefined, {
      status: 'pending', origin: 'sentry_spike', category: 'technical',
    });
    expect(h.get().triageItems).toHaveLength(1);
    expect(h.get().triageCursor).toBe('c1');
    expect(h.get().triageHasMore).toBe(true);
    expect(h.get().triageCounts?.pending).toBe(6);
    expect(h.get().triageLoading).toBe(false);
  });

  it('appends the next keyset page and de-dupes overlapping rows', async () => {
    triageIdeasMock.mockResolvedValue({ ideas: [idea({ id: 'a' })], cursor: 'c1', hasMore: true, counts: counts() });
    const h = harness();
    await h.get().fetchTriageIdeas(undefined, { status: 'pending' });

    triageIdeasMock.mockResolvedValue({
      ideas: [idea({ id: 'a' }), idea({ id: 'b' })], cursor: null, hasMore: false, counts: counts(),
    });
    await h.get().fetchMoreTriageIdeas(undefined, { status: 'pending' });

    expect(triageIdeasMock).toHaveBeenLastCalledWith(undefined, undefined, 'c1', {
      status: 'pending', origin: undefined, category: undefined,
    });
    expect(h.get().triageItems.map((i) => i.id)).toEqual(['a', 'b']);
    expect(h.get().triageHasMore).toBe(false);
  });

  it('does not continue a page without a cursor', async () => {
    const h = harness();
    await h.get().fetchMoreTriageIdeas(undefined, { status: 'pending' });
    expect(triageIdeasMock).not.toHaveBeenCalled();
  });
});

describe('devToolsTriageSlice — verdict bookkeeping', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('moves the row out of the bucket it was actually in', async () => {
    triageIdeasMock.mockResolvedValue({
      ideas: [idea({ id: 'a', status: 'rejected' })], cursor: null, hasMore: false,
      counts: counts({ pending: 6, rejected: 1, accepted: 3 }),
    });
    const h = harness();
    await h.get().fetchTriageIdeas(undefined, { status: 'rejected' });

    acceptIdeaMock.mockResolvedValue(idea({ id: 'a', status: 'accepted' }));
    await h.get().acceptIdea('a');

    // `rejected` paid for the move, not `pending`.
    expect(h.get().triageCounts).toMatchObject({ pending: 6, rejected: 0, accepted: 4 });
    expect(h.get().triageItems[0]!.status).toBe('accepted');
  });

  it('sends the status the CALLER saw as the compare-and-swap expectation', async () => {
    // The row's status in this slice is only a default; a surface that renders
    // its own copy (the triage deck deals its own idea page) passes what IT
    // showed. Getting this wrong means a stale verdict silently overwrites
    // whoever decided first, and fires a second decision-memory fan-out.
    triageIdeasMock.mockResolvedValue({
      ideas: [idea({ id: 'a', status: 'rejected' })], cursor: null, hasMore: false,
      counts: counts(),
    });
    const h = harness();
    await h.get().fetchTriageIdeas(undefined, { status: 'rejected' });

    acceptIdeaMock.mockResolvedValue(idea({ id: 'a', status: 'accepted' }));
    await h.get().acceptIdea('a');
    expect(acceptIdeaMock).toHaveBeenCalledWith('a', 'rejected');

    await h.get().acceptIdea('a', 'pending');
    expect(acceptIdeaMock).toHaveBeenLastCalledWith('a', 'pending');
  });

  it('REJECTS on a failed write instead of swallowing it', async () => {
    // The triage deck resolves a card the moment it decides; without this
    // rejection it has nothing to restore from and every failed verdict — every
    // lost compare-and-swap against Athena's overnight pass — looks like a
    // completed decision.
    const h = harness();
    acceptIdeaMock.mockRejectedValueOnce(new Error('database is locked'));
    await expect(h.get().acceptIdea('a')).rejects.toThrow('database is locked');

    vi.mocked(devApi.rejectIdea).mockRejectedValueOnce(
      new Error("Backlog idea a was already decided as 'accepted' by a concurrent action"),
    );
    await expect(h.get().rejectIdea('a')).rejects.toThrow(/concurrent action/);
  });

  it('never drives a bucket negative and decrements total on delete', async () => {
    triageIdeasMock.mockResolvedValue({
      ideas: [idea({ id: 'a' })], cursor: null, hasMore: false,
      counts: counts({ total: 1, pending: 0, accepted: 0, rejected: 0 }),
    });
    const h = harness();
    await h.get().fetchTriageIdeas(undefined, { status: 'pending' });

    deleteIdeaMock.mockResolvedValue(true);
    await h.get().deleteTriageIdea('a');

    expect(h.get().triageItems).toHaveLength(0);
    expect(h.get().triageCounts).toMatchObject({ total: 0, pending: 0 });
  });
});

/**
 * Three properties the Hub cannot be shipped without.
 *
 * 1. ALL THREE review statuses survive one load. The store slice keeps only
 *    the last filter a panel asked for, which is why the Hub's counts read 0.
 * 2. A rejection SUPERSEDES: the row stays in the feed carrying its reason,
 *    and the reason token reaches `twin_review_memory` as the reviewer note.
 * 3. `busyId` is the pressed row's id, so one press never lights a sibling's
 *    spinner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

const h = vi.hoisted(() => ({
  addToast: vi.fn(),
  storeState: {
    activeTwinId: 't1' as string | null,
    twinProfiles: [{ id: 't1', name: 'Test Twin', role: null, knowledge_base_id: null, obsidian_subpath: 'p/t' }],
    fetchTwinProfiles: vi.fn(async () => {}),
    fetchTwinReadinessApproved: vi.fn(async () => {}),
    bindTwinKnowledgeBase: vi.fn(async () => {}),
    unbindTwinKnowledgeBase: vi.fn(async () => {}),
    setPendingTrainingQuestions: vi.fn(),
  },
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: unknown) => unknown) => selector(h.storeState),
}));

vi.mock('@/stores/toastStore', () => {
  const useToastStore = (selector: (s: unknown) => unknown) => selector({ addToast: h.addToast });
  (useToastStore as unknown as { getState: () => unknown }).getState = () => ({ addToast: h.addToast });
  return { useToastStore };
});

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    language: 'en',
    tx: (s: string) => s,
    // Every `t.twin.hub.<a>.<b>` read resolves to its own key path.
    t: { twin: { hub: deepKeyProxy('') } },
  }),
}));

function deepKeyProxy(prefix: string): unknown {
  return new Proxy({}, {
    get: (_t, key: string) => (typeof key === 'string' ? deepKeyProxy(prefix ? `${prefix}.${key}` : key) : undefined),
    // Reading it as a string (a toast/error message) yields the key path.
    has: () => true,
  });
}

vi.mock('@/api/vault/database/vectorKb', () => ({
  getKnowledgeBase: vi.fn(async () => null),
  listKnowledgeBases: vi.fn(async () => []),
  createKnowledgeBase: vi.fn(async () => ({ id: 'kb1' })),
}));

vi.mock('@/api/twin/twin', () => ({
  listPendingMemories: vi.fn(),
  listCommunications: vi.fn(async () => []),
  listDistilledFacts: vi.fn(async () => []),
  listTwinReflections: vi.fn(async () => []),
  listTwinContacts: vi.fn(async () => []),
  wikiStatus: vi.fn(async () => ({ exists: false, fileCount: 0, lastCompiledAt: null, dirPath: '' })),
  reviewMemory: vi.fn(),
  generateBio: vi.fn(),
  createDistilledFact: vi.fn(),
  deleteDistilledFact: vi.fn(),
  deleteTwinReflection: vi.fn(),
  reflectOnTwin: vi.fn(),
  compileWiki: vi.fn(),
  auditWiki: vi.fn(),
  ingestDoctrineDocs: vi.fn(),
}));

import * as twinApi from '@/api/twin/twin';
import { useHubFeed } from '../useHubFeed';

function mem(over: Partial<TwinPendingMemory> = {}): TwinPendingMemory {
  return {
    id: 'm1', twin_id: 't1', channel: 'training', content: 'body', title: 'Title',
    importance: 3, status: 'pending', reviewer_notes: null, source_communication_id: null,
    created_at: '2026-01-01T00:00:00Z', reviewed_at: null, ...over,
  };
}

const listPending = vi.mocked(twinApi.listPendingMemories);
const review = vi.mocked(twinApi.reviewMemory);

beforeEach(() => {
  vi.clearAllMocks();
  listPending.mockImplementation(async (_twinId: string, status?: string) => {
    if (status === 'pending') return [mem({ id: 'p1' }), mem({ id: 'p2' })];
    if (status === 'approved') return [mem({ id: 'a1', status: 'approved' })];
    if (status === 'rejected') return [mem({ id: 'r1', status: 'rejected', reviewer_notes: 'too_long' })];
    return [];
  });
});

describe('useHubFeed', () => {
  it('keeps all three review statuses from one load (the counts bug)', async () => {
    const { result } = renderHook(() => useHubFeed());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // One load asked for each status exactly once...
    const asked = listPending.mock.calls.map((c) => c[1]);
    expect(asked).toEqual(expect.arrayContaining(['pending', 'approved', 'rejected']));
    // ...and all three survived into the feed rather than the last one winning.
    expect(result.current.counts.pending).toBe(2);
    expect(result.current.counts.approved).toBe(1);
    expect(result.current.counts.rejected).toBe(1);
    expect(result.current.entries).toHaveLength(4);
    expect(result.current.error).toBeNull();
  });

  it('reject supersedes: the row stays in the feed and records the reason', async () => {
    review.mockImplementation(async (id: string, _approved: boolean, notes?: string) =>
      mem({ id, status: 'rejected', reviewer_notes: notes ?? null }));

    const { result } = renderHook(() => useHubFeed());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.entries.find((e) => e.id === 'p1')!;
    await act(async () => { await result.current.reject(target, 'off_brand'); });

    expect(review).toHaveBeenCalledWith('p1', false, 'off_brand');
    const after = result.current.entries.find((e) => e.id === 'p1');
    expect(after).toBeDefined();
    expect(after!.status).toBe('rejected');
    expect(after!.reviewerNotes).toBe('off_brand');
    // Nothing was removed; the ledger only grew a verdict.
    expect(result.current.entries).toHaveLength(4);
    expect(result.current.counts.rejected).toBe(2);
    expect(result.current.counts.pending).toBe(1);
  });

  it('busyId is scoped to the pressed row, never a sibling', async () => {
    let release!: (row: TwinPendingMemory) => void;
    review.mockImplementation(() => new Promise<TwinPendingMemory>((res) => { release = res; }));

    const { result } = renderHook(() => useHubFeed());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.busyId).toBeNull();

    const first = result.current.entries.find((e) => e.id === 'p1')!;
    const sibling = result.current.entries.find((e) => e.id === 'p2')!;
    let pending!: Promise<void>;
    act(() => { pending = result.current.approve(first); });

    await waitFor(() => expect(result.current.busyId).toBe('p1'));
    expect(result.current.busyId).not.toBe(sibling.id);

    await act(async () => { release(mem({ id: 'p1', status: 'approved' })); await pending; });
    expect(result.current.busyId).toBeNull();
  });
});

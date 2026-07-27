// The unified Backlog's data path: ONE cross-project keyset read of
// `dev_ideas` plus its facet counts, shared by the table, the detail ledger and
// (from P5) the focus deck.
//
// Before this, Approvals fetched 100 pending ideas through
// `dev_tools_list_pending_ideas` while Dev Tools' Idea Triage fetched the whole
// idea table for ONE project through a different slice — same rows, two data
// paths, two truths. This wraps the (now real) `dev_tools_triage_ideas` command
// through `devToolsTriageSlice`, with `projectId` deliberately omitted so the
// Backlog is cross-project by default.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TriageCounts } from '@/lib/bindings/TriageCounts';

import { toBacklogIdea, type BacklogIdea } from './backlogModel';

/** One page is deliberately generous — the facet rail is only truthful about
 *  loaded rows, and the L0 counts cover everything beyond them. */
const PAGE_SIZE = 100;

export type BacklogStatus = 'pending' | 'accepted' | 'rejected' | 'archived';

export interface BacklogQueue {
  rows: BacklogIdea[];
  counts: TriageCounts | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  status: BacklogStatus;
  setStatus: (s: BacklogStatus) => void;
  loadMore: () => void;
  reload: () => void;
  /** Id of the idea whose verdict is in flight, or null. */
  actingId: string | null;
  accept: (id: string) => Promise<void>;
  reject: (id: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Project names present in the loaded rows, for the project column filter. */
  projectOptions: { value: string; label: string }[];
}

export function useBacklogQueue(): BacklogQueue {
  const {
    triageItems, triageCounts, triageHasMore, triageLoading, triageLoadingMore,
    fetchTriageIdeas, fetchMoreTriageIdeas, acceptIdea, rejectIdea, deleteTriageIdea,
  } = useSystemStore(useShallow((s) => ({
    triageItems: s.triageItems,
    triageCounts: s.triageCounts,
    triageHasMore: s.triageHasMore,
    triageLoading: s.triageLoading,
    triageLoadingMore: s.triageLoadingMore,
    fetchTriageIdeas: s.fetchTriageIdeas,
    fetchMoreTriageIdeas: s.fetchMoreTriageIdeas,
    acceptIdea: s.acceptIdea,
    rejectIdea: s.rejectIdea,
    deleteTriageIdea: s.deleteTriageIdea,
  })));
  const projects = useSystemStore((s) => s.projects);

  const [status, setStatus] = useState<BacklogStatus>('pending');
  const [actingId, setActingId] = useState<string | null>(null);

  const nameOf = useCallback(
    (projectId: string | null) =>
      (projectId && projects.find((p) => p.id === projectId)?.name) || '',
    [projects],
  );

  const reload = useCallback(() => {
    void fetchTriageIdeas(undefined, { status, limit: PAGE_SIZE });
  }, [fetchTriageIdeas, status]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = useCallback(() => {
    void fetchMoreTriageIdeas(undefined, { status, limit: PAGE_SIZE });
  }, [fetchMoreTriageIdeas, status]);

  // Filtering by the ACTIVE status locally is what makes a verdict optimistic:
  // the slice rewrites the acted-on row in place, so it drops out of the
  // pending view on the same frame without a refetch.
  const rows = useMemo(
    () => triageItems.filter((i) => i.status === status).map((i) => toBacklogIdea(i, nameOf)),
    [triageItems, status, nameOf],
  );

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.projectId && r.projectName) seen.set(r.projectId, r.projectName);
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const act = useCallback(
    async (id: string, run: () => Promise<void>) => {
      setActingId(id);
      try { await run(); }
      catch (err) { silentCatch('useBacklogQueue:act')(err); }
      finally { setActingId(null); }
    },
    [],
  );

  const accept = useCallback((id: string) => act(id, () => acceptIdea(id)), [act, acceptIdea]);
  const reject = useCallback(
    (id: string, reason?: string) => act(id, () => rejectIdea(id, reason)),
    [act, rejectIdea],
  );
  const remove = useCallback(
    (id: string) => act(id, () => deleteTriageIdea(id)),
    [act, deleteTriageIdea],
  );

  return {
    rows,
    counts: triageCounts,
    loading: triageLoading,
    loadingMore: triageLoadingMore,
    hasMore: triageHasMore,
    status,
    setStatus,
    loadMore,
    reload,
    actingId,
    accept,
    reject,
    remove,
    projectOptions,
  };
}

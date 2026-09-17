import { useCallback, useEffect, useRef, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import { trackInteraction } from '@/lib/analytics';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listTeamMemories,
  createTeamMemory,
  deleteTeamMemory,
  updateTeamMemory,
  updateTeamMemoryImportance,
  getTeamMemoryCount,
  getTeamMemoryStats,
} from '@/api/pipeline/teamMemories';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';

const PAGE_SIZE = 30;

/**
 * Analytics category for every mutation this hook owns.
 *
 * The five handlers below used to complete with a success toast and nothing
 * else, so nothing anywhere could tell "teams do not curate memories" apart
 * from "teams curate memories and we never measured it" — which is exactly the
 * evidence any later consolidation/decay work would have to be prioritised on.
 *
 * Only identifier strings cross this seam: the operation and its outcome. No
 * memory id, title, content or team id — see `lib/analytics/sink.ts`.
 */
const IX_CATEGORY = 'team_memory';
const IX_OK = 'ok';
const IX_FAILED = 'failed';

/**
 * Data layer for `TeamMemoryPanel` — list + count + stats with category /
 * search / run filters, paged loading, and CRUD handlers that confirm via
 * toast. The panel components were orphaned when the DAG canvas was retired;
 * this hook is the re-mount plumbing that lets any surface host them.
 */
export function useTeamMemories(teamId: string) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [memories, setMemories] = useState<TeamMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TeamMemoryStats | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  // The third pane state. `isFetching` already separates loading from settled,
  // but a REJECTED list left `memories` at [] with nothing to distinguish it
  // from a team that genuinely has no memories — so a failed IPC taught the
  // operator their team shares no knowledge. Failure is retryable; emptiness is
  // not. (docs/design/overview-loading.md law 1 and its sibling.)
  const [loadFailed, setLoadFailed] = useState(false);
  // Filters live in a ref: the panel owns the filter UI state and calls
  // onFilter/onFilterByRun; we only need the current values for refetches.
  const filtersRef = useRef<{ category?: string; search?: string; runId?: string }>({});
  // Every list-replacing fetch carries an identity minted at issue time. The
  // search box refetches on a 300ms debounce and each category chip refetches
  // immediately, so three IPCs are routinely in flight at once -- and without
  // this guard whichever RESOLVES last won, which is not the same as whichever
  // was ASKED last. The visible symptom is a filtered list re-populating with
  // the previous filter's rows a beat after the user narrowed it.
  const listWinsRef = useRef(createLatestWins());

  const refresh = useCallback(async () => {
    const { category, search, runId } = filtersRef.current;
    const token = listWinsRef.current.next();
    // First page paints without waiting on count/stats. Don't clear rows
    // already on screen (law 1); ghost only into emptiness via isFetching.
    setIsFetching(true);
    setLoadFailed(false);
    try {
      const rows = await listTeamMemories(teamId, runId, category, search, PAGE_SIZE, 0);
      if (!listWinsRef.current.isCurrent(token)) return;
      setMemories(rows);
      setIsFetching(false);
      const [count, st] = await Promise.all([
        getTeamMemoryCount(teamId, runId, category, search),
        getTeamMemoryStats(teamId, category, search),
      ]);
      if (!listWinsRef.current.isCurrent(token)) return;
      setTotal(count);
      setStats(st);
    } catch (err) {
      // Only the CURRENT request may paint the failure: a superseded filter's
      // rejection must not put a retry over the rows the newer one is fetching.
      if (listWinsRef.current.isCurrent(token)) setLoadFailed(true);
      throw err;
    } finally {
      if (listWinsRef.current.isCurrent(token)) setIsFetching(false);
    }
  }, [teamId]);

  /** Re-issue the current filter's fetch. The toast is the caller's, as on the
   *  initial load; the pane's own state is what this hook owns. */
  const onRetry = useCallback(() => {
    refresh().catch(toastCatch('teamMemory/useTeamMemories:retry'));
  }, [refresh]);

  useEffect(() => {
    filtersRef.current = {};
    refresh().catch(toastCatch('teamMemory/useTeamMemories:initialLoad'));
  }, [refresh]);

  const onFilter = useCallback((category?: string, search?: string) => {
    filtersRef.current = { ...filtersRef.current, category, search };
    refresh().catch(toastCatch('teamMemory/useTeamMemories:filter'));
  }, [refresh]);

  const onFilterByRun = useCallback((runId: string | null) => {
    filtersRef.current = { ...filtersRef.current, runId: runId ?? undefined };
    trackInteraction(IX_CATEGORY, 'filter_run', runId ? 'set' : 'cleared');
    refresh().catch(toastCatch('teamMemory/useTeamMemories:runFilter'));
  }, [refresh]);

  const onLoadMore = useCallback(async () => {
    const { category, search, runId } = filtersRef.current;
    const token = listWinsRef.current.next();
    try {
      const next = await listTeamMemories(teamId, runId, category, search, PAGE_SIZE, memories.length);
      // A page computed against an offset the list no longer has would append
      // duplicates (or rows from the previous filter) below the current ones.
      if (!listWinsRef.current.isCurrent(token)) return;
      setMemories((prev) => [...prev, ...next]);
    } catch (err) {
      toastCatch('teamMemory/useTeamMemories:loadMore')(err);
    }
  }, [teamId, memories.length]);

  const onCreate = useCallback((input: CreateTeamMemoryInput) => {
    createTeamMemory(input)
      .then(() => {
        trackInteraction(IX_CATEGORY, 'create', IX_OK);
        addToast(t.pipeline.memory_created, 'success');
        return refresh();
      })
      .catch((err) => {
        trackInteraction(IX_CATEGORY, 'create', IX_FAILED);
        toastCatch('teamMemory/useTeamMemories:create')(err);
      });
  }, [addToast, refresh, t]);

  const onDelete = useCallback((id: string) => {
    deleteTeamMemory(id)
      .then(() => {
        trackInteraction(IX_CATEGORY, 'delete', IX_OK);
        addToast(t.pipeline.memory_deleted, 'success');
        return refresh();
      })
      .catch((err) => {
        trackInteraction(IX_CATEGORY, 'delete', IX_FAILED);
        toastCatch('teamMemory/useTeamMemories:delete')(err);
      });
  }, [addToast, refresh, t]);

  const onImportanceChange = useCallback((id: string, importance: number) => {
    // Optimistic — the dots respond instantly; a failed write rolls back via refresh.
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, importance } : m)));
    updateTeamMemoryImportance(id, importance).then(() => {
      trackInteraction(IX_CATEGORY, 'importance', IX_OK);
    }).catch((err) => {
      trackInteraction(IX_CATEGORY, 'importance', IX_FAILED);
      toastCatch('teamMemory/useTeamMemories:importance')(err);
      refresh().catch(toastCatch('teamMemory/useTeamMemories:importanceRollback'));
    });
  }, [refresh]);

  const onEdit = useCallback((id: string, title: string, content: string, category: string, importance: number) => {
    updateTeamMemory(id, title, content, category, importance)
      .then(() => {
        trackInteraction(IX_CATEGORY, 'edit', IX_OK);
        addToast(t.pipeline.memory_updated, 'success');
        return refresh();
      })
      .catch((err) => {
        trackInteraction(IX_CATEGORY, 'edit', IX_FAILED);
        toastCatch('teamMemory/useTeamMemories:edit')(err);
      });
  }, [addToast, refresh, t]);

  return { memories, total, stats, isFetching, loadFailed, onRetry, onFilter, onFilterByRun, onLoadMore, onCreate, onDelete, onImportanceChange, onEdit };
}

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import { getExecution } from '@/api/agents/executions';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import type { GlobalExecutionListItem } from '@/lib/bindings/GlobalExecutionListItem';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

/** The filter vocabulary, one entry per bucket `ExecutionCounts` reports.
 *  `cancelled` and `incomplete` were missing here AND from the counts: a
 *  cancelled run sat inside the "All" total and under no filter, so the user
 *  could see it counted and never reach it. */
export type FilterStatus = 'all' | 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
export const FILTER_ORDER: FilterStatus[] = ['all', 'running', 'completed', 'failed', 'cancelled', 'incomplete'];

export type SelectedExecution = PersonaExecution & { persona_name?: string };

/**
 * Data half of the Overview activity ledger: store wiring, server-side status
 * filter + counts, client-side persona/model filters, running-run polling and
 * the notification deep-link (`pendingExecutionFocus`).
 */
export function useGlobalExecutionFeed() {
  const s = useOverviewStore(useShallow((st) => ({
    rows: st.globalExecutions,
    hasMore: st.globalExecutionsHasMore,
    warning: st.globalExecutionsWarning,
    fetchRows: st.fetchGlobalExecutions,
    counts: st.globalExecutionCounts,
    fetchCounts: st.fetchGlobalExecutionCounts,
    pendingFocus: st.pendingExecutionFocus,
    setPendingFocus: st.setPendingExecutionFocus,
  })));
  const personas = useAgentStore((st) => st.personas);
  const { selectedPersonaId } = useOverviewFilterValues();

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  // True while a (re)fetch for the current filter context is in flight. It
  // only decides ghost-vs-empty for an EMPTY region; rows on screen stay put.
  const [isFetching, setIsFetching] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const statusParam = filter === 'all' ? undefined : filter;
  const personaParam = selectedPersonaId || undefined;

  // The list rows are lean; the detail modal wants the whole record, hydrated
  // through `get_execution` only for the row actually opened.
  const [selectedExec, setSelectedExec] = useState<SelectedExecution | null>(null);
  const openExecution = useCallback(async (row: GlobalExecutionListItem) => {
    try {
      const full = await getExecution(row.id, row.personaId);
      setSelectedExec({ ...full, persona_name: row.personaName ?? undefined });
    } catch (err) {
      toastCatch('activity:open-execution')(err);
    }
  }, []);

  // Persona runs don't always record the model the CLI ran with — fall back to
  // the persona's configured model so the Model column isn't perpetually blank.
  const personaModelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personas) if (p.model_profile) m.set(p.id, p.model_profile);
    return m;
  }, [personas]);

  const rows = useMemo(() => s.rows.filter((e) => {
    if (selectedPersonaId && e.personaId !== selectedPersonaId) return false;
    if (filter === 'running' ? e.status !== 'running' && e.status !== 'pending' : filter !== 'all' && e.status !== filter) return false;
    return modelFilter === 'all' || e.modelUsed === modelFilter;
  }), [s.rows, selectedPersonaId, filter, modelFilter]);

  // Distinct models across the loaded rows (no server-side model param). The
  // active selection stays listed even when its rows page out.
  const models = useMemo(() => {
    const distinct = new Set<string>();
    for (const e of s.rows) if (e.modelUsed) distinct.add(e.modelUsed);
    if (modelFilter !== 'all') distinct.add(modelFilter);
    return [...distinct].sort();
  }, [s.rows, modelFilter]);

  const { fetchRows, fetchCounts } = s;
  const reload = useCallback(
    () => Promise.all([fetchRows(true, statusParam), fetchCounts(personaParam)]),
    [fetchRows, fetchCounts, statusParam, personaParam],
  );

  useEffect(() => {
    let active = true;
    setIsFetching(true);
    reload()
      .catch(silentCatch('GlobalExecutionList:load'))
      .finally(() => { if (active) setIsFetching(false); });
    return () => { active = false; };
  }, [reload]);

  // Pop the detail modal when a notification click parks an execution id. A
  // miss triggers ONE fetch; a second miss for the same id gives up — without
  // the guard an id that never appears refetched in a tight loop.
  const focusFetchAttemptedForRef = useRef<string | null>(null);
  const { pendingFocus, setPendingFocus } = s;
  useEffect(() => {
    if (!pendingFocus) return;
    const match = s.rows.find((e) => e.id === pendingFocus);
    if (match || focusFetchAttemptedForRef.current === pendingFocus) {
      if (match) void openExecution(match);
      setPendingFocus(null);
      return;
    }
    focusFetchAttemptedForRef.current = pendingFocus;
    void fetchRows(true, statusParam).catch(silentCatch('GlobalExecutionList:focusFetch'));
  }, [pendingFocus, s.rows, fetchRows, setPendingFocus, statusParam, openExecution]);

  const hasRunning = useMemo(() => s.rows.some((e) => e.status === 'running' || e.status === 'pending'), [s.rows]);
  const pollFetch = useCallback(async () => {
    await fetchRows(true, statusParam);
    await fetchCounts(personaParam);
  }, [fetchRows, fetchCounts, statusParam, personaParam]);
  usePolling(pollFetch, {
    interval: POLLING_CONFIG.runningExecutions.interval,
    enabled: hasRunning,
    maxBackoff: POLLING_CONFIG.runningExecutions.maxBackoff,
  });

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try { await reload(); } finally { setIsRefreshing(false); }
  }, [reload]);
  const loadMore = useCallback(() => { void fetchRows(false, statusParam); }, [fetchRows, statusParam]);

  const statusCounts: Record<FilterStatus, number> = {
    all: s.counts.total,
    running: s.counts.running,
    completed: s.counts.completed,
    failed: s.counts.failed,
    cancelled: s.counts.cancelled,
    incomplete: s.counts.incomplete,
  };

  return {
    rows, total: s.counts.total, statusCounts, hasMore: s.hasMore, warning: s.warning,
    personas, personaModelById, models,
    filter, setFilter, modelFilter, setModelFilter, selectedPersonaId,
    isFetching, isRefreshing, refresh, loadMore,
    selectedExec, setSelectedExec, openExecution,
  };
}

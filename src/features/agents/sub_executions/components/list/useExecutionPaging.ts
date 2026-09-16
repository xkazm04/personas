import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { listExecutionsSummary } from '@/api/agents/executions';
import { toastCatch } from '@/lib/silentCatch';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

// One page of run history. Matches the backend default (list_items_by_persona_id
// LIMIT 50) so the store's initial fetch and each "load more" page line up.
export const EXECUTION_PAGE_SIZE = 50;

/**
 * Paging over the store's first page: additional pages are fetched on demand
 * and appended locally, reset whenever the persona changes so one persona's
 * tail never shows under another.
 */
export function useExecutionPaging(personaId: string, firstPage: ExecutionListItem[], loadFailedBody: string) {
  const [extraRows, setExtraRows] = useState<ExecutionListItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  // Rows the SERVER returned in the extra pages — counted BEFORE de-duplication,
  // because the offset is a server-side skip and a row we already hold still
  // occupied a slot in that window.
  const [extraServerRows, setExtraServerRows] = useState(0);
  useEffect(() => { setExtraRows([]); setReachedEnd(false); setExtraServerRows(0); }, [personaId]);

  // The store's first page as the SERVER returned it. NOT `firstPage.length`:
  // `upsertFinishedExecution` prepends locally finished runs into that array,
  // and the cache survives a persona switch — paging off it would ask the
  // server to skip rows it never handed over. Falls back to the visible length
  // when unknown (a prefetch page, server-fresh by construction).
  const serverFirstPageCount = useAgentStore((state) => state.executionsServerCount[personaId]);

  // De-duplicated union of the first page + loaded extra pages. Offset paging
  // runs over the raw ordering, so simulations stay in; display filters apply later.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: ExecutionListItem[] = [];
    for (const r of [...firstPage, ...extraRows]) {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    }
    return out;
  }, [firstPage, extraRows]);

  const serverOffset = (serverFirstPageCount ?? firstPage.length) + extraServerRows;
  const hasMore = !reachedEnd && serverOffset >= EXECUTION_PAGE_SIZE;

  const loadMore = useCallback(async () => {
    if (!personaId || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listExecutionsSummary(personaId, EXECUTION_PAGE_SIZE, serverOffset);
      setExtraServerRows((prev) => prev + page.length);
      if (page.length < EXECUTION_PAGE_SIZE) setReachedEnd(true);
      if (page.length > 0) setExtraRows((prev) => [...prev, ...page]);
    } catch (err) {
      toastCatch('execution-list:loadMore', loadFailedBody)(err);
    } finally {
      setLoadingMore(false);
    }
  }, [personaId, loadingMore, serverOffset, loadFailedBody]);

  return { rows, hasMore, loadingMore, loadMore };
}

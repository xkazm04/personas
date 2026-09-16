import { useState, useMemo, useCallback } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { createLogger } from '@/lib/log';
import { silentCatch } from '@/lib/silentCatch';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import { useBulkRerun } from '../../libs/useBulkRerun';
import { isFailedExecutionStatus } from '../../libs/executionStatus';

const logger = createLogger('execution-list');

/** Bulk re-run selection + cohort lifecycle for the persona run ledger. */
export function useExecutionBulk(personaId: string, visibleRows: ExecutionListItem[], failedToast: string) {
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(false);
  const bulkRerun = useBulkRerun();

  const toggle = useCallback((executionId: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(executionId)) next.delete(executionId);
      else next.add(executionId);
      return next;
    });
  }, []);

  const enter = useCallback(() => { setBulkMode(true); setBulkSelected(new Set()); }, []);
  const exit = useCallback(() => {
    setBulkMode(false);
    setBulkSelected(new Set());
    setShowReport(false);
    bulkRerun.reset();
  }, [bulkRerun]);

  const selectFailed = useCallback((sinceIso?: string) => {
    setBulkSelected(new Set(visibleRows
      .filter((row) => isFailedExecutionStatus(row.status) && (!sinceIso || (row.started_at ?? row.created_at) >= sinceIso))
      .map((row) => row.id)));
  }, [visibleRows]);

  // ONE derivation of the selection, shared by the label and the handler
  // (bulk-selection-actions.md §7 D3). A failed simulation picked by "select
  // all failed" stays in `bulkSelected` after simulations are hidden again, so
  // counting the Set said N while the rerun did M < N.
  const selectedRows = useMemo(
    () => visibleRows.filter((row) => bulkSelected.has(row.id)),
    [visibleRows, bulkSelected],
  );

  const start = useCallback(async () => {
    if (!personaId) return;
    // Re-entry guard: a second `start()` mints a new latest-wins token and
    // ABANDONS the running cohort while its executePersona calls keep billing.
    if (bulkRerun.phase === 'running') return;
    if (selectedRows.length === 0) return;
    setShowReport(false);
    try {
      await bulkRerun.start(selectedRows, personaId);
      setShowReport(true);
      void useAgentStore.getState().fetchExecutions(personaId).catch(silentCatch('execution-list:postBulkRerunFetch'));
    } catch (err) {
      logger.warn('Bulk rerun failed', { err });
      useToastStore.getState().addToast(failedToast, 'error');
    }
  }, [bulkRerun, selectedRows, personaId, failedToast]);

  return {
    bulkMode, setBulkMode, bulkSelected, toggle, enter, exit, selectFailed,
    clear: () => setBulkSelected(new Set()),
    selectedRows, start, bulkRerun, showReport, setShowReport,
    running: bulkRerun.phase === 'running',
  };
}

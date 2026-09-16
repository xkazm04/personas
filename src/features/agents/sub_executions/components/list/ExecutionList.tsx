import { useState, useMemo, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { useDensity } from '@/hooks/utility/data/useDensity';
import { useExecutionAnnotations } from '@/hooks/agents/useExecutionAnnotations';
import { silentCatch } from '@/lib/silentCatch';
import { UnifiedTable } from '@/features/shared/components/display/UnifiedTable';
import { timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import { ExecutionDetailModal } from '@/features/shared/components/modals/ExecutionDetailModal';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import { useExecutionList, getSampleInput } from '../../libs/useExecutionList';
import { deriveExecutionOrigin, type ExecutionOrigin } from '../../libs/executionOrigin';
import { ActiveChainsBadge } from '../ActiveChainsBadge';
import { executionRowAccent } from '../table/ExecutionCells';
import { ExecutionComparison } from './ExecutionComparison';
import { BulkRerunStrip } from './BulkRerunStrip';
import { BulkRerunReport } from './BulkRerunReport';
import { ExecutionListToolbar } from './ExecutionListToolbar';
import { ExecutionListError, ExecutionListFirstRun } from './ExecutionListStates';
import { ExecutionSelectCell } from './ExecutionSelectCell';
import { useExecutionPaging, EXECUTION_PAGE_SIZE } from './useExecutionPaging';
import { useExecutionCompare } from './useExecutionCompare';
import { useExecutionBulk } from './useExecutionBulk';
import { useExecutionColumns, type StatusFilter } from './useExecutionColumns';
import { useExecutionDetail } from './useExecutionDetail';

const ROW_HEIGHT = 48;

export interface ExecutionListProps {
  /**
   * Mount the "N chains in flight" badge above the table. Default true. The
   * persona Activity tab passes `false` because its own permanent header
   * mounts the badge; two copies would poll `list_active_chains` twice.
   */
  showActiveChains?: boolean;
}

/** The persona run ledger — same table primitive and cells as Overview → Activity. */
export function ExecutionList({ showActiveChains = true }: ExecutionListProps = {}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);
  const personaId = selectedPersona?.id || '';
  const { executions: firstPage, loading, error, refresh } = useExecutionList(personaId);
  const { byExecution: annotationsByExecution, annotations } = useExecutionAnnotations(personaId);
  const { density, setDensity } = useDensity('execution-list');
  const useCases = useSelectedUseCases();

  const [showSimulations, setShowSimulations] = useState(false);
  const [originFilter, setOriginFilter] = useState<ExecutionOrigin | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [capabilityFilter, setCapabilityFilter] = useState('all');
  useEffect(() => { setOriginFilter(null); setStatusFilter('all'); setCapabilityFilter('all'); }, [personaId]);

  const paging = useExecutionPaging(personaId, firstPage, e.load_failed_body);
  const hasSimulations = useMemo(() => paging.rows.some((r) => r.is_simulation), [paging.rows]);
  const rows = useMemo(() => paging.rows.filter((r) => {
    // Filtering for origin 'simulation' implies wanting simulations, so it bypasses the toggle.
    if (originFilter && deriveExecutionOrigin(r).origin !== originFilter) return false;
    if (!showSimulations && originFilter !== 'simulation' && r.is_simulation) return false;
    if (statusFilter === 'running' ? r.status !== 'running' && r.status !== 'pending' : statusFilter !== 'all' && r.status !== statusFilter) return false;
    return capabilityFilter === 'all' || (r.use_case_id ?? '') === capabilityFilter;
  }), [paging.rows, originFilter, showSimulations, statusFilter, capabilityFilter]);

  const compare = useExecutionCompare(personaId, paging.rows, annotationsByExecution, e);
  const bulk = useExecutionBulk(personaId, rows, e.bulk_rerun_failed_toast);
  const detail = useExecutionDetail(compare.hydrate, selectedPersona?.name);

  const [sampleInput, setSampleInput] = useState('{}');
  useEffect(() => {
    // Keep the '{}' default — sample input is hint-only, not load-bearing.
    getSampleInput(selectedPersona?.name).then(setSampleInput, silentCatch('execution-list:getSampleInput'));
  }, [selectedPersona?.name]);

  const titleById = useMemo(() => new Map(useCases.map((uc) => [uc.id, uc.title])), [useCases]);
  const capabilityTitle = useCallback((id: string | null) => (id ? titleById.get(id) ?? null : null), [titleById]);
  const capabilityOptions = useMemo(
    () => [{ value: 'all', label: t.agents.lab.all_use_cases }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))],
    [useCases, t.agents.lab.all_use_cases],
  );

  const selecting = bulk.bulkMode || compare.compareMode;
  const columnArgs = useMemo(() => ({
    capabilityTitle, capabilityOptions, capabilityFilter, onCapabilityFilter: setCapabilityFilter,
    statusFilter, onStatusFilter: setStatusFilter, originFilter, onOriginFilter: setOriginFilter,
    selectCell: selecting
      ? (row: ExecutionListItem) => <ExecutionSelectCell row={row} bulk={bulk} compare={compare} />
      : null,
    onCompareRetry: selecting ? null : (id: string) => { void compare.compareRetry(id); },
  }), [capabilityTitle, capabilityOptions, capabilityFilter, statusFilter, originFilter, selecting, bulk, compare]);
  const columns = useExecutionColumns(columnArgs);

  const groupLabels = useMemo(() => timeGroupLabels(t), [t]);
  const groupBy = useCallback((row: ExecutionListItem) => {
    const key = timeGroupKey(row.started_at || row.created_at);
    return { key, label: groupLabels[key] };
  }, [groupLabels]);

  const handleRowClick = useCallback((row: ExecutionListItem) => {
    if (bulk.bulkMode) { if (!bulk.running) bulk.toggle(row.id); return; }
    if (compare.compareMode) { compare.select(row.id); return; }
    void detail.open(row.id);
  }, [bulk, compare, detail]);

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-foreground">{e.no_persona_selected}</div>;
  }
  if (compare.showComparison && compare.left && compare.right) {
    return <ExecutionComparison left={compare.left} right={compare.right} onClose={compare.exit} />;
  }
  if (bulk.showReport && bulk.bulkRerun.phase === 'completed') {
    return (
      <BulkRerunReport
        cohort={bulk.bulkRerun.cohort}
        items={bulk.bulkRerun.items}
        onClose={bulk.exit}
        onCompareItem={(orig, next) => { bulk.setShowReport(false); bulk.setBulkMode(false); void compare.openPair(orig, next); }}
      />
    );
  }

  const neverRan = !loading && !error && paging.rows.length === 0;
  return (
    <div className="space-y-3">
      <ExecutionListToolbar
        rows={rows} annotations={annotations}
        showSimulations={showSimulations} setShowSimulations={setShowSimulations} hasSimulations={hasSimulations}
        compare={compare} bulk={bulk} density={density} setDensity={setDensity}
      />
      {showActiveChains && <ActiveChainsBadge />}
      {(bulk.running || (bulk.bulkRerun.phase === 'completed' && !bulk.showReport)) && (
        <BulkRerunStrip
          phase={bulk.bulkRerun.phase}
          items={bulk.bulkRerun.items}
          cohort={bulk.bulkRerun.cohort}
          onCancel={bulk.bulkRerun.cancel}
          onOpenReport={() => bulk.setShowReport(true)}
        />
      )}

      {error && paging.rows.length === 0 ? (
        <ExecutionListError onRetry={() => { void refresh(); }} />
      ) : neverRan ? (
        <ExecutionListFirstRun onTryIt={() => setRerunInputData(sampleInput)} />
      ) : (
        <div className="animate-fade-slide-in">
          <UnifiedTable<ExecutionListItem>
            columns={columns}
            data={rows}
            getRowKey={(r) => r.id}
            onRowClick={handleRowClick}
            isLoading={loading}
            rowHeight={ROW_HEIGHT}
            groupBy={groupBy}
            rowAccent={(r) => (bulk.bulkSelected.has(r.id) || r.id === compare.compareLeft || r.id === compare.compareRight
              ? 'border-l-primary'
              : executionRowAccent(r.status))}
            density={density === 'compact' ? 'compact' : 'comfortable'}
            tableId="persona-executions"
            ariaLabel={e.history}
            emptyTitle={t.common.no_results}
            scrollRestoreKey={`persona-executions|${personaId}`}
            className="max-h-[70vh]"
          />
          {paging.hasMore && (
            <button
              type="button"
              onClick={() => { void paging.loadMore(); }}
              disabled={paging.loadingMore}
              aria-busy={paging.loadingMore}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2 typo-heading rounded-modal bg-secondary/30 text-foreground border border-primary/15 hover:bg-secondary/50 disabled:opacity-60 transition-colors"
            >
              {paging.loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tx(e.load_more, { count: EXECUTION_PAGE_SIZE })}
            </button>
          )}
        </div>
      )}

      {detail.execution && <ExecutionDetailModal execution={detail.execution} onClose={detail.close} />}
    </div>
  );
}

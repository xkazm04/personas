import { useState, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, BarChart3, Bot, Plus, BookOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useSystemStore } from '@/stores/systemStore';
import { MotionEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import { UnifiedTable } from '@/features/shared/components/display/UnifiedTable';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { FilterBar } from '@/features/shared/components/overlays/FilterBar';
import { ExecutionDetailModal } from '@/features/shared/components/modals/ExecutionDetailModal';
import { useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { executionRowAccent } from '@/features/agents/sub_executions/components/table/ExecutionCells';
import type { GlobalExecutionListItem } from '@/lib/bindings/GlobalExecutionListItem';
import { ExecutionMetricsDashboard } from './ExecutionMetricsDashboard';
import { useGlobalExecutionFeed, FILTER_ORDER, type FilterStatus } from './useGlobalExecutionFeed';
import { useGlobalExecutionColumns } from './useGlobalExecutionColumns';

const EXEC_ROW_HEIGHT = 56;

interface GlobalExecutionListProps {
  /** Extra action buttons to render in the header (left of Metrics/Refresh) */
  headerActions?: React.ReactNode;
}

const HEADER_BTN = 'flex items-center gap-1.5 px-3 py-1.5 rounded-modal transition-colors border';
const HEADER_BTN_IDLE = 'text-foreground hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border-primary/15';

/**
 * Overview → Activity: every persona's runs as one ledger. Rendered through
 * `UnifiedTable`, which owns the ghost-under-header cold load, the one-shot
 * row cascade, sticky day groups, column resize and keyboard nav.
 */
export default function GlobalExecutionList({ headerActions }: GlobalExecutionListProps) {
  const { t, tx } = useTranslation();
  const act = t.overview.activity;
  const feed = useGlobalExecutionFeed();
  const { setSelectedPersonaId } = useOverviewFilterActions();
  const [showDashboard, setShowDashboard] = useState(false);

  const columns = useGlobalExecutionColumns({
    personas: feed.personas,
    personaModelById: feed.personaModelById,
    models: feed.models,
    selectedPersonaId: feed.selectedPersonaId,
    onPersonaChange: setSelectedPersonaId,
    filter: feed.filter,
    onFilterChange: feed.setFilter,
    modelFilter: feed.modelFilter,
    onModelFilterChange: feed.setModelFilter,
  });

  const filterLabel = useCallback(
    (id: FilterStatus) => (id === 'all' ? t.common.all : tokenLabel(t, 'execution', id)),
    [t],
  );
  // Bucket the newest-first stream under sticky Today / Yesterday / … headers.
  const groupLabels = useMemo(() => timeGroupLabels(t), [t]);
  const groupBy = useCallback((exec: GlobalExecutionListItem) => {
    const key = timeGroupKey(exec.startedAt || exec.createdAt);
    return { key, label: groupLabels[key] };
  }, [groupLabels]);
  const context = `status=${feed.filter}|model=${feed.modelFilter}|persona=${feed.selectedPersonaId || 'all'}`;
  // Nothing recorded anywhere (not merely filtered away) → the onboarding
  // empty state. A filtered-empty ledger keeps its header so filters stay reachable.
  const nothingRecorded = !feed.isFetching && feed.total === 0 && feed.rows.length === 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Loader2 className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title={act.title}
        subtitle={tx(feed.total !== 1 ? act.recorded : act.recorded_one, { count: feed.total })}
        actions={
          <div className="flex items-center gap-2">
            {headerActions}
            {feed.total > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDashboard(!showDashboard)}
                  className={`${HEADER_BTN} ${showDashboard ? 'text-blue-400 bg-blue-500/15 border-blue-500/25' : HEADER_BTN_IDLE}`}
                  title={showDashboard ? act.show_list : act.show_metrics}
                >
                  <BarChart3 className="w-5 h-5" />
                  <span className="typo-body font-medium">{showDashboard ? act.list : act.metrics}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { void feed.refresh(); }}
                  disabled={feed.isRefreshing}
                  className={`${HEADER_BTN} ${HEADER_BTN_IDLE} disabled:opacity-60`}
                  title={t.common.refresh}
                >
                  <RefreshCw className={`w-5 h-5 ${feed.isRefreshing ? 'animate-spin' : ''}`} />
                  <span className="typo-body font-medium">{t.common.refresh}</span>
                </button>
              </>
            )}
          </div>
        }
      />

      {showDashboard ? (
        <ContentBody flex>
          <ExecutionMetricsDashboard onClose={() => setShowDashboard(false)} />
        </ContentBody>
      ) : (
        <>
          <FilterBar<FilterStatus>
            options={FILTER_ORDER.map((id) => ({ id, label: filterLabel(id), badge: feed.statusCounts[id] }))}
            value={feed.filter}
            onChange={feed.setFilter}
            badgeStyle="paren"
            layoutIdPrefix="execution-filter"
            summary={tx(act.showing, { count: feed.rows.length, total: feed.total })}
          />

          {feed.warning && (
            <div className="mx-4 md:mx-6 mt-3 rounded-modal border border-amber-500/25 bg-amber-500/10 px-3 py-2 typo-body text-amber-300/90" role="status" aria-live="polite">
              {feed.warning}
            </div>
          )}

          <ContentBody flex>
            {nothingRecorded ? (
              <div className="flex-1 flex items-center justify-center p-4 md:p-6">
                <MotionEmptyState
                  motif="activity"
                  content={{
                    icon: Bot,
                    title: feed.personas.length === 0 ? act.no_agents : act.no_executions,
                    subtitle: feed.personas.length === 0 ? act.no_agents_hint : act.no_executions_hint,
                    action: { label: act.create_persona, onClick: () => useSystemStore.getState().setSidebarSection('personas'), icon: Plus },
                    secondaryAction: { label: act.from_templates, onClick: () => useSystemStore.getState().setSidebarSection('design-reviews'), icon: BookOpen },
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                <UnifiedTable<GlobalExecutionListItem>
                  columns={columns}
                  data={feed.rows}
                  getRowKey={(e) => e.id}
                  onRowClick={(e) => { void feed.openExecution(e); }}
                  isLoading={feed.isFetching}
                  rowHeight={EXEC_ROW_HEIGHT}
                  rowAccent={(e) => executionRowAccent(e.status)}
                  groupBy={groupBy}
                  tableId="overview-activity"
                  ariaLabel={act.title}
                  emptyTitle={act.no_executions}
                  scrollRestoreKey={`overview/activity|${context}`}
                  rowReveal={{ resetKey: context }}
                  borderless
                  className="flex-1"
                />
                {feed.hasMore && (
                  <div className="flex-shrink-0 pt-3 pb-2 text-center border-t border-primary/5">
                    <button type="button" onClick={feed.loadMore} className={`px-4 py-2 typo-heading ${HEADER_BTN} ${HEADER_BTN_IDLE} mx-auto`}>
                      {act.load_more}
                    </button>
                  </div>
                )}
              </div>
            )}
          </ContentBody>
        </>
      )}

      {feed.selectedExec && (
        <ExecutionDetailModal execution={feed.selectedExec} onClose={() => feed.setSelectedExec(null)} />
      )}
    </ContentBox>
  );
}

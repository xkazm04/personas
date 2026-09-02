import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { ExecutionDetailModal } from '@/features/shared/components/modals/ExecutionDetailModal';
import { formatModelShort } from '@/lib/utils/formatters';
import type { GlobalExecutionListItem } from '@/lib/bindings/GlobalExecutionListItem';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { getExecution } from '@/api/agents/executions';
import { toastCatch } from '@/lib/silentCatch';

/**
 * Per-call LLM usage table (Overview › Executions › "Calls" subtab).
 *
 * Surfaces the model / thinking-effort / token / cost the DB already records on
 * every execution as a queryable per-call table — the local-first counterpart
 * to an external LLM tracker. Reads the same paged `globalExecutions` the
 * Activity list loads (`list_all_executions` → `GlobalExecutionListItem`, which
 * already carries `model_used`, `thinking_level`, `input_tokens`,
 * `output_tokens`, `cost_usd`); no new IPC command. Filtering (model + rolling
 * time window) and sorting run client-side over the loaded rows, which the
 * store caps at the 500 most recent — the "recent-N" bound. `Load more` (wired
 * to the table's end-reached) grows that page up to the cap.
 *
 * Loading choreography (docs/design/overview-loading.md v2): `isFetching` goes
 * straight to `UnifiedTable`, which owns the whole cold-load contract — calm
 * delayed ghost rows under its real column header while the row region is
 * empty and a fetch runs, the settled-only empty state, and the id-guarded
 * row cascade (`rowReveal` below just scopes the cascade's reset key to the
 * window+model context). Pre-warmed rows already in `globalExecutions` paint
 * on the first frame regardless of `isFetching`; a refetch never hides them.
 */

type TimeWindow = '24h' | '7d' | '30d' | 'all';

const WINDOW_MS: Record<TimeWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

const ROW_HEIGHT = 52;

/** Resolved epoch-ms timestamp for a row (started, falling back to created). */
function rowTime(e: GlobalExecutionListItem): number {
  return new Date(e.startedAt || e.createdAt).getTime();
}

interface LlmCallsTableProps {
  /** Subtab switcher rendered in the toolbar so both views share one control. */
  headerSwitch?: ReactNode;
}

export default function LlmCallsTable({ headerSwitch }: LlmCallsTableProps) {
  const { t, tx, language } = useTranslation();
  const {
    globalExecutions,
    globalExecutionsHasMore,
    globalExecutionCounts,
    fetchGlobalExecutions,
    fetchGlobalExecutionCounts,
  } = useOverviewStore(
    useShallow((s) => ({
      globalExecutions: s.globalExecutions,
      globalExecutionsHasMore: s.globalExecutionsHasMore,
      globalExecutionCounts: s.globalExecutionCounts,
      fetchGlobalExecutions: s.fetchGlobalExecutions,
      fetchGlobalExecutionCounts: s.fetchGlobalExecutionCounts,
    })),
  );
  const personas = useAgentStore((s) => s.personas);

  const [timeWindow, setTimeWindow] = useState<TimeWindow>('7d');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  // In-flight, nothing more — NEVER hides rows already on screen. Only
  // decides whether an empty row region shows ghost rows (fetch running) or
  // the (UnifiedTable-owned) empty state (fetch settled, genuinely nothing).
  const [isFetching, setIsFetching] = useState(true);
  // Lean rows in the table, the full record in the modal - hydrated on open
  // through `get_execution` rather than shipped with every page.
  const [selectedExec, setSelectedExec] = useState<(PersonaExecution & { persona_name?: string }) | null>(null);
  const openExecution = useCallback(async (row: GlobalExecutionListItem) => {
    try {
      const full = await getExecution(row.id, row.personaId);
      setSelectedExec({ ...full, persona_name: row.personaName ?? undefined });
    } catch (err) {
      toastCatch('llm-calls:open-execution')(err);
    }
  }, []);
  const loadingMoreRef = useRef(false);

  // Persona-configured model backfills runs that never recorded `model_used`,
  // matching the Activity list so the Model column isn't perpetually blank.
  const personaModelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personas) if (p.model_profile) m.set(p.id, p.model_profile);
    return m;
  }, [personas]);

  const resolveModel = useCallback(
    (e: GlobalExecutionListItem): string | null => e.modelUsed ?? personaModelById.get(e.personaId) ?? null,
    [personaModelById],
  );

  // First mount / subtab entry: load the newest page (all statuses) + counts.
  // Tracked locally (the store itself has no request-level loading flag) so
  // the table body can gate ghosts on `isFetching` (docs/design/overview-loading.md).
  useEffect(() => {
    let active = true;
    (async () => {
      setIsFetching(true);
      try {
        await Promise.all([fetchGlobalExecutions(true), fetchGlobalExecutionCounts()]);
      } finally {
        if (active) setIsFetching(false);
      }
    })();
    return () => { active = false; };
  }, [fetchGlobalExecutions, fetchGlobalExecutionCounts]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchGlobalExecutions(true), fetchGlobalExecutionCounts()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchGlobalExecutions, fetchGlobalExecutionCounts]);

  const handleLoadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    void fetchGlobalExecutions(false).finally(() => {
      loadingMoreRef.current = false;
    });
  }, [fetchGlobalExecutions]);

  // Distinct resolved models across every loaded row — the Model column filter.
  // The active selection stays even when its rows page out, so the chip keeps
  // its label.
  const modelOptions = useMemo(() => {
    const distinct = new Set<string>();
    for (const e of globalExecutions) {
      const m = resolveModel(e);
      if (m) distinct.add(m);
    }
    if (modelFilter !== 'all') distinct.add(modelFilter);
    return [
      { value: 'all', label: t.overview.activity.all_models },
      ...[...distinct].sort().map((m) => ({ value: m, label: formatModelShort(m) ?? m })),
    ];
  }, [globalExecutions, modelFilter, resolveModel, t]);

  const rows = useMemo(() => {
    const now = Date.now();
    const windowMs = WINDOW_MS[timeWindow];
    return globalExecutions.filter((e) => {
      if (modelFilter !== 'all' && resolveModel(e) !== modelFilter) return false;
      if (windowMs !== Number.POSITIVE_INFINITY && now - rowTime(e) > windowMs) return false;
      return true;
    });
  }, [globalExecutions, modelFilter, timeWindow, resolveModel]);

  const windowTabs = useMemo<SegmentedTab<TimeWindow>[]>(
    () => [
      { id: '24h', label: '24h' },
      { id: '7d', label: '7d' },
      { id: '30d', label: '30d' },
      { id: 'all', label: t.common.all },
    ],
    [t],
  );

  const columns = useMemo<TableColumn<GlobalExecutionListItem>[]>(
    () => [
      {
        key: 'time',
        label: t.overview.activity.col_started,
        width: 'minmax(120px, 1fr)',
        sortable: true,
        sortFn: (a, b) => rowTime(a) - rowTime(b),
        render: (e) => (
          <RelativeTime timestamp={e.startedAt || e.createdAt} className="typo-code text-foreground font-mono" />
        ),
      },
      {
        key: 'persona',
        label: t.overview.execution_list.col_persona,
        width: 'minmax(180px, 2fr)',
        render: (e) => (
          <span className="flex items-center gap-2 min-w-0">
            <PersonaIcon icon={e.personaIcon ?? null} color={e.personaColor ?? null} name={e.personaName ?? undefined} display="framed" frameSize="lg" />
            <span className="typo-body text-foreground truncate">{e.personaName || t.overview.activity.unknown}</span>
          </span>
        ),
      },
      {
        key: 'model',
        label: t.overview.activity.col_model,
        width: 'minmax(150px, 1.4fr)',
        filterOptions: modelOptions,
        filterValue: modelFilter,
        onFilterChange: setModelFilter,
        render: (e) => {
          const resolved = resolveModel(e);
          const short = formatModelShort(resolved);
          return (
            <span className="flex items-center gap-1.5 min-w-0">
              {short ? (
                <Tooltip content={resolved ?? ''}>
                  <span className="typo-code text-foreground font-mono truncate">{short}</span>
                </Tooltip>
              ) : (
                <span className="typo-code text-foreground font-mono">{'—'}</span>
              )}
              {e.thinkingLevel && (
                <span
                  title={t.agents.executions.thinking_tooltip}
                  className="shrink-0 px-1.5 py-0.5 rounded-card typo-caption bg-secondary/40 border border-primary/10 text-foreground"
                >
                  {tokenLabel(t, 'thinking', e.thinkingLevel)}
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: 'input',
        label: t.agents.executions.input,
        width: '96px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => a.inputTokens - b.inputTokens,
        render: (e) =>
          e.inputTokens > 0 ? (
            <Numeric value={e.inputTokens} unit="compact" language={language} align="right" className="typo-code text-foreground" />
          ) : (
            <span className="typo-code text-foreground font-mono">{'—'}</span>
          ),
      },
      {
        key: 'output',
        label: t.agents.executions.output,
        width: '96px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => a.outputTokens - b.outputTokens,
        render: (e) =>
          e.outputTokens > 0 ? (
            <Numeric value={e.outputTokens} unit="compact" language={language} align="right" className="typo-code text-foreground" />
          ) : (
            <span className="typo-code text-foreground font-mono">{'—'}</span>
          ),
      },
      {
        key: 'cost',
        label: t.overview.activity.col_cost,
        width: '104px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => a.costUsd - b.costUsd,
        render: (e) =>
          e.costUsd > 0 ? (
            <Numeric value={e.costUsd} unit="usd" language={language} align="right" className="typo-code text-foreground" />
          ) : (
            <span className="typo-code text-foreground font-mono">{'—'}</span>
          ),
      },
    ],
    [t, language, modelOptions, modelFilter, resolveModel],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          {headerSwitch}
          <span className="typo-caption text-foreground truncate">
            {tx(t.overview.activity.showing, { count: rows.length, total: globalExecutionCounts.total })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedTabs<TimeWindow>
            tabs={windowTabs}
            activeTab={timeWindow}
            onTabChange={setTimeWindow}
            variant="segment"
            size="sm"
            fullWidth={false}
            ariaLabel={t.overview.usage_filters.time_range_label}
          />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-interactive text-foreground hover:bg-primary/8 disabled:opacity-60 focus-ring"
            title={t.common.refresh}
            aria-label={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col mx-4 md:mx-6 mb-3">
        <UnifiedTable<GlobalExecutionListItem>
          columns={columns}
          data={rows}
          getRowKey={(e) => e.id}
          onRowClick={(e) => void openExecution(e)}
          isLoading={isFetching}
          rowHeight={ROW_HEIGHT}
          density="compact"
          defaultSortKey="time"
          defaultSortDir="desc"
          tableId="overview-llm-calls"
          ariaLabel={t.overview.activity.title}
          emptyTitle={t.overview.activity.no_executions}
          rowReveal={{ resetKey: `${timeWindow}|${modelFilter}` }}
          onEndReached={globalExecutionsHasMore ? handleLoadMore : undefined}
        />
      </div>

      {selectedExec && <ExecutionDetailModal execution={selectedExec} onClose={() => setSelectedExec(null)} />}
    </div>
  );
}

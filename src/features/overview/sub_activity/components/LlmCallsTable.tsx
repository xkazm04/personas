import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useColumnWidths } from '@/features/shared/components/display/ColumnResize';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { ExecutionDetailModal } from '@/features/shared/components/modals/ExecutionDetailModal';
import { formatModelShort } from '@/lib/utils/formatters';
import type { GlobalExecution } from '@/lib/types/types';

/**
 * Per-call LLM usage table (Overview › Executions › "Calls" subtab).
 *
 * Surfaces the model / thinking-effort / token / cost the DB already records on
 * every execution as a queryable per-call table — the local-first counterpart
 * to an external LLM tracker. Reads the same paged `globalExecutions` the
 * Activity list loads (`list_all_executions` → `GlobalExecutionRow`, which
 * already carries `model_used`, `thinking_level`, `input_tokens`,
 * `output_tokens`, `cost_usd`); no new IPC command. Filtering (model + rolling
 * time window) and sorting run client-side over the loaded rows, which the
 * store caps at the 500 most recent — the "recent-N" bound. `Load more` (wired
 * to the table's end-reached) grows that page up to the cap.
 *
 * Loading choreography (docs/design/overview-loading.md v2): `isFetching`
 * gates ghost rows ONLY into an empty region (`isFetching && rows.length ===
 * 0`); pre-warmed rows already in `globalExecutions` paint on the first frame
 * regardless of `isFetching`. `UnifiedTable` owns header + row rendering as a
 * single opaque unit (no prop to inject a per-row `RevealItem` cascade or to
 * split header from body), so the recipe's row-cascade step is a reported gap
 * here rather than hacked in — rows render instantly the frame they arrive
 * (law 2), which is the actual requirement; only the entrance ripple is
 * missing. The ghost also mimics the table shape (header band + rows) instead
 * of reusing UnifiedTable's real interactive header, for the same reason.
 */

type TimeWindow = '24h' | '7d' | '30d' | 'all';

const WINDOW_MS: Record<TimeWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

const ROW_HEIGHT = 52;

// Mirrors the real 6-column grid (time/persona/model/input/output/cost) —
// same key+width pairs as the `columns` memo below — so `useColumnWidths`
// produces an identical `gridTemplateColumns` for the ghost rows as
// UnifiedTable computes for the real header/rows (same tableId + localStorage
// key), including any user column-resize overrides.
const CALLS_COLUMNS: { key: string; width: string }[] = [
  { key: 'time', width: 'minmax(120px, 1fr)' },
  { key: 'persona', width: 'minmax(180px, 2fr)' },
  { key: 'model', width: 'minmax(150px, 1.4fr)' },
  { key: 'input', width: '96px' },
  { key: 'output', width: '96px' },
  { key: 'cost', width: '104px' },
];

/** Resolved epoch-ms timestamp for a row (started, falling back to created). */
function rowTime(e: GlobalExecution): number {
  return new Date(e.started_at || e.created_at).getTime();
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
  const [selectedExec, setSelectedExec] = useState<GlobalExecution | null>(null);
  const loadingMoreRef = useRef(false);

  // Persona-configured model backfills runs that never recorded `model_used`,
  // matching the Activity list so the Model column isn't perpetually blank.
  const personaModelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personas) if (p.model_profile) m.set(p.id, p.model_profile);
    return m;
  }, [personas]);

  const resolveModel = useCallback(
    (e: GlobalExecution): string | null => e.model_used ?? personaModelById.get(e.persona_id) ?? null,
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

  // Ghost rows only when the row region would otherwise be empty while a
  // fetch runs — rows already on screen (pre-warmed store, prior visit) are
  // never hidden. `callsGridTemplate` mirrors the real UnifiedTable header's
  // grid-template exactly (same tableId → same localStorage-backed resize
  // state) so the ghost→content swap moves nothing.
  const showGhost = isFetching && rows.length === 0;
  const colWidths = useColumnWidths('overview-llm-calls');
  const callsGridTemplate = colWidths.template(CALLS_COLUMNS);

  const windowTabs = useMemo<SegmentedTab<TimeWindow>[]>(
    () => [
      { id: '24h', label: '24h' },
      { id: '7d', label: '7d' },
      { id: '30d', label: '30d' },
      { id: 'all', label: t.common.all },
    ],
    [t],
  );

  const columns = useMemo<TableColumn<GlobalExecution>[]>(
    () => [
      {
        key: 'time',
        label: t.overview.activity.col_started,
        width: 'minmax(120px, 1fr)',
        sortable: true,
        sortFn: (a, b) => rowTime(a) - rowTime(b),
        render: (e) => (
          <RelativeTime timestamp={e.started_at || e.created_at} className="typo-code text-foreground font-mono" />
        ),
      },
      {
        key: 'persona',
        label: t.overview.execution_list.col_persona,
        width: 'minmax(180px, 2fr)',
        render: (e) => (
          <span className="flex items-center gap-2 min-w-0">
            <PersonaIcon icon={e.persona_icon ?? null} color={e.persona_color ?? null} name={e.persona_name} display="framed" frameSize="lg" />
            <span className="typo-body text-foreground truncate">{e.persona_name || t.overview.activity.unknown}</span>
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
              {e.thinking_level && (
                <span
                  title={t.agents.executions.thinking_tooltip}
                  className="shrink-0 px-1.5 py-0.5 rounded-card typo-caption bg-secondary/40 border border-primary/10 text-foreground"
                >
                  {tokenLabel(t, 'thinking', e.thinking_level)}
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
        sortFn: (a, b) => a.input_tokens - b.input_tokens,
        render: (e) =>
          e.input_tokens > 0 ? (
            <Numeric value={e.input_tokens} unit="compact" language={language} align="right" className="typo-code text-foreground" />
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
        sortFn: (a, b) => a.output_tokens - b.output_tokens,
        render: (e) =>
          e.output_tokens > 0 ? (
            <Numeric value={e.output_tokens} unit="compact" language={language} align="right" className="typo-code text-foreground" />
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
        sortFn: (a, b) => a.cost_usd - b.cost_usd,
        render: (e) =>
          e.cost_usd > 0 ? (
            <Numeric value={e.cost_usd} unit="usd" language={language} align="right" className="typo-code text-foreground" />
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
        {showGhost ? (
          /* Nothing to show yet + fetch in flight: calm ghost table under the
             mimicked column geometry. Invisible for its first ~120ms
             (animation-delay + fill-mode both) so a fast fetch skips it
             entirely; the real UnifiedTable replaces it the frame data
             arrives — no gate, no held content (law 2). */
          <CallsGhostRows gridTemplate={callsGridTemplate} />
        ) : (
          <UnifiedTable<GlobalExecution>
            columns={columns}
            data={rows}
            getRowKey={(e) => e.id}
            rowReveal={{ resetKey: `${timeWindow}|${modelFilter}` }}
            onRowClick={setSelectedExec}
            rowHeight={ROW_HEIGHT}
            density="compact"
            defaultSortKey="time"
            defaultSortDir="desc"
            tableId="overview-llm-calls"
            ariaLabel={t.overview.activity.title}
            emptyTitle={t.overview.activity.no_executions}
            onEndReached={globalExecutionsHasMore ? handleLoadMore : undefined}
          />
        )}
      </div>

      {selectedExec && <ExecutionDetailModal execution={selectedExec} onClose={() => setSelectedExec(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CallsGhostRows — calm ghost table for the ONLY moment the row region has
// nothing to show (a fetch with a cold store / empty filter+window context).
//
// Each ghost enters via `animate-fade-in` (150ms, fill-mode: both) behind a
// staggered animation-delay starting at 120ms — `both` holds opacity 0 through
// the delay, so a fetch that resolves quickly never paints a single ghost.
// UnifiedTable owns header + row rendering as one opaque unit (see the module
// doc comment above `LlmCallsTable`), so this mimics its shape — header band
// + rows in the same grid geometry — rather than showing the real interactive
// header underneath. No `animate-pulse` — the entrance stagger is the only
// motion.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghost rows read as rows, not a barcode. */
const GHOST_NAME_WIDTHS = ['w-32', 'w-24', 'w-28', 'w-20'];

function CallsGhostRows({ gridTemplate }: { gridTemplate: string }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col border border-primary/10 rounded-modal overflow-hidden" aria-hidden="true">
      <div
        className="grid border-b border-primary/10 bg-primary/5 px-4 py-2.5 animate-fade-in"
        style={{ gridTemplateColumns: gridTemplate, animationDelay: '120ms' }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className={`h-2.5 w-12 ${GHOST_BAR} ${i >= 3 ? 'justify-self-end' : ''}`} />
        ))}
      </div>
      {Array.from({ length: 10 }).map((_, i) => {
        const nameW = GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length];
        const delay = `${140 + i * 35}ms`;
        return (
          <div
            key={i}
            className="grid items-center px-4 border-b border-primary/[0.06] last:border-b-0 animate-fade-in"
            style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT, animationDelay: delay }}
          >
            <span className="h-3.5 w-16 rounded bg-primary/[0.06]" />
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded-full bg-primary/[0.06] flex-shrink-0" />
              <span className={`h-3.5 ${nameW} max-w-full ${GHOST_BAR}`} />
            </span>
            <span className={`h-3.5 w-20 ${GHOST_BAR}`} />
            <span className={`h-3.5 w-10 ${GHOST_BAR} justify-self-end`} />
            <span className={`h-3.5 w-10 ${GHOST_BAR} justify-self-end`} />
            <span className={`h-3.5 w-12 ${GHOST_BAR} justify-self-end`} />
          </div>
        );
      })}
    </div>
  );
}

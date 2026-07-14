// Variant — "Roster+".
//
// The same spine as Roster (one ROW per context group, that group's contexts
// laid out inline inside it, tinted by worst-wins KPI health), but each context
// is a two-storey tile instead of a one-line pill: the LABEL on top, a
// horizontal divider, and then the indicators the Cross-tab ledger carries in
// its gutter — Features · Goals · KPIs — plus the per-context scan action.
//
// So Roster answers "where is the red?" at a glance, and Roster+ answers "and
// what is attached to it?" without opening anything. It costs width: fewer
// contexts fit per row.
import { useMemo, useState } from 'react';
import { Gauge, Layers, Search, Sparkles, Target } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { colorDot } from './GroupColorPicker';
import { LedgerActions, ProposalStrip, type ContextLedgerProps } from './contextLedgerShared';
import { KpiLegend } from './ContextGroupRowsPills';
import {
  KPI_STATUS_SURFACE,
  KPI_STATUS_DOT,
  KPI_STATUS_LABEL_KEY,
  type ContextKpiStatus,
} from './contextKpiStatus';

export default function ContextGroupRowsStats(props: ContextLedgerProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.plugins.dev_tools;
  const {
    groups,
    useCaseState,
    selectedUseCaseId,
    selectedCtxId,
    onSelectCtx,
    goalCoverageByContext,
    kpiCoverageByContext,
    kpiStatusByContext,
    hasMap,
    onScanContext,
    scanningContextId,
    scanBusy,
  } = props;

  const [query, setQuery] = useState('');

  const contextNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const c of g.contexts) m.set(c.id, c.name);
    return m;
  }, [groups]);

  const highlighted = useMemo(() => {
    const uc = useCaseState.useCases.find((u) => u.id === selectedUseCaseId);
    return new Set(uc?.context_ids ?? []);
  }, [useCaseState.useCases, selectedUseCaseId]);

  const featureCountByContext = useMemo(() => {
    const m = new Map<string, number>();
    for (const uc of useCaseState.useCases) {
      if (uc.status === 'archived') continue;
      for (const cid of uc.context_ids) m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [useCaseState.useCases]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        contexts: g.contexts.filter(
          (c) => c.name.toLowerCase().includes(q) || c.keywords.some((k) => k.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.contexts.length > 0);
  }, [groups, query]);

  const statusOf = (id: string): ContextKpiStatus => kpiStatusByContext.get(id) ?? 'none';

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="typo-section-title flex items-center gap-1.5 shrink-0">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t.uc_title}
          {useCaseState.active.length > 0 && (
            <span className="typo-caption text-foreground tabular-nums">({useCaseState.active.length})</span>
          )}
        </h3>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.context_search_placeholder}
            aria-label={t.context_search_placeholder}
            className={`${INPUT_FIELD} !py-1 !pl-8 !text-sm`}
          />
        </div>
        <KpiLegend t={t} />
        <div className="flex items-center gap-1.5 shrink-0">
          <LedgerActions state={useCaseState} hasMap={hasMap} t={t} />
        </div>
      </div>

      <ProposalStrip
        proposals={useCaseState.proposed}
        onAccept={useCaseState.accept}
        onReject={useCaseState.reject}
        contextNames={contextNames}
        t={t}
        tx={tx}
      />

      <div className="rounded-card border border-primary/10 overflow-auto min-h-0 flex-1 divide-y divide-primary/[0.07]">
        {filteredGroups.map((g) => {
          const dot = colorDot(g.color);
          return (
            <div key={g.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-secondary/[0.06] transition-colors">
              {/* the group — one per row */}
              <div className="flex items-center gap-1.5 shrink-0 w-44 pt-1.5">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot.bg}`} />
                <span className="typo-title truncate">{g.name}</span>
                <span className="typo-caption text-foreground/50 tabular-nums shrink-0">{g.contexts.length}</span>
              </div>

              {/* its contexts, inline */}
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {g.contexts.map((c) => {
                  const status = statusOf(c.id);
                  const selected = c.id === selectedCtxId;
                  const dimmed = highlighted.size > 0 && !highlighted.has(c.id);
                  const scanning = scanningContextId === c.id;
                  return (
                    // A div, not a button — the tile hosts its own scan button and
                    // nested buttons are invalid HTML.
                    <div
                      key={c.id}
                      className={`w-[12.5rem] rounded-card border transition-colors ${KPI_STATUS_SURFACE[status]} ${
                        selected ? 'ring-1 ring-primary/60' : ''
                      } ${dimmed ? 'opacity-35' : ''}`}
                    >
                      {/* label */}
                      <button
                        type="button"
                        onClick={() => onSelectCtx(selected ? null : c.id)}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left min-w-0"
                      >
                        <Tooltip content={t[KPI_STATUS_LABEL_KEY[status]]}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KPI_STATUS_DOT[status]}`} />
                        </Tooltip>
                        <span className="typo-body font-medium text-foreground truncate">{c.name}</span>
                      </button>

                      {/* the divider, then the indicators */}
                      <div className="border-t border-foreground/10 flex items-center gap-2.5 px-2 py-1">
                        <Indicator
                          icon={<Layers className="w-3 h-3" />}
                          n={featureCountByContext.get(c.id) ?? 0}
                          stem="text-sky-300"
                          label={t.uc_title}
                        />
                        <Indicator
                          icon={<Target className="w-3 h-3" />}
                          n={goalCoverageByContext.get(c.id)?.count ?? 0}
                          stem="text-violet-300"
                          label={t.context_detail_goals_heading}
                        />
                        <Indicator
                          icon={<Gauge className="w-3 h-3" />}
                          n={kpiCoverageByContext.get(c.id) ?? 0}
                          stem="text-rose-300"
                          label={t.ctx_indicator_kpis}
                        />

                        <Tooltip content={t.context_scan_ideas_tooltip}>
                          <button
                            type="button"
                            onClick={() => { if (!scanBusy) onScanContext(c.id); }}
                            disabled={scanBusy}
                            aria-label={t.context_scan_ideas_tooltip}
                            className="ml-auto shrink-0 grid place-items-center w-5 h-5 rounded-full border border-primary/15 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {scanning ? <LoadingSpinner size="xs" /> : <Sparkles className="w-3 h-3" />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {query.trim() && filteredGroups.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center px-6">
            <Search className="w-6 h-6 text-foreground/30" />
            <p className="typo-caption text-foreground/60">
              {t.context_search_no_results} “{query.trim()}”
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** One indicator — icon + count, muted to nothing at zero so a tile's colour
 *  comes from what it actually has. */
function Indicator({
  icon,
  n,
  stem,
  label,
}: {
  icon: React.ReactNode;
  n: number;
  stem: string;
  label: string;
}) {
  return (
    <Tooltip content={`${n} ${label}`}>
      <span className={`inline-flex items-center gap-0.5 typo-caption tabular-nums ${n > 0 ? stem : 'text-foreground/25'}`}>
        {icon}
        {n}
      </span>
    </Tooltip>
  );
}

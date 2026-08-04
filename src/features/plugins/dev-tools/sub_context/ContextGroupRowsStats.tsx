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
import { Layers, Search } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { colorDot } from './GroupColorPicker';
import { LedgerActions, ProposalStrip, type ContextLedgerProps } from './contextLedgerShared';
import { RosterTile, rosterRowHeight, skipStyle, useFilteredGroups } from './contextMapPerf';
import {
  KPI_STATUS_DOT,
  KPI_STATUS_LABEL_KEY,
  isNeutral,
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

  // Deferred so a keystroke paints the input before the whole board re-filters.
  const { filteredGroups, deferredQuery } = useFilteredGroups(groups, query);

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
            <div
              key={g.id}
              className="flex items-start gap-3 px-3 py-2.5 hover:bg-secondary/[0.06] transition-colors"
              style={skipStyle(rosterRowHeight(g.contexts.length))}
            >
              {/* the group — one per row */}
              <div className="flex items-center gap-1.5 shrink-0 w-44 pt-1.5">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot.bg}`} />
                <span className="typo-title truncate">{g.name}</span>
                <span className="typo-caption text-foreground/50 tabular-nums shrink-0">{g.contexts.length}</span>
              </div>

              {/* its contexts, inline */}
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {g.contexts.map((c) => (
                  <RosterTile
                    key={c.id}
                    ctx={c}
                    status={statusOf(c.id)}
                    selected={c.id === selectedCtxId}
                    dimmed={highlighted.size > 0 && !highlighted.has(c.id)}
                    featureCount={featureCountByContext.get(c.id) ?? 0}
                    goalCount={goalCoverageByContext.get(c.id)?.count ?? 0}
                    kpiCount={kpiCoverageByContext.get(c.id) ?? 0}
                    scanning={scanningContextId === c.id}
                    scanBusy={scanBusy}
                    onSelectCtx={onSelectCtx}
                    onScanContext={onScanContext}
                    t={t}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {deferredQuery.trim() && filteredGroups.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center px-6">
            <Search className="w-6 h-6 text-foreground/30" />
            <p className="typo-caption text-foreground/60">
              {t.context_search_no_results} “{deferredQuery.trim()}”
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The colour key — without it, a tinted board is a guessing game. */
function KpiLegend({ t }: { t: ReturnType<typeof useTranslation>['t']['plugins']['dev_tools'] }) {
  const shown: ContextKpiStatus[] = ['met', 'on-track', 'off-track', 'unmeasured'];
  return (
    <div className="hidden lg:flex items-center gap-2.5 shrink-0 mr-1">
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 typo-caption text-foreground/60">
          <span className={`w-1.5 h-1.5 rounded-full ${KPI_STATUS_DOT[s]}`} />
          {t[KPI_STATUS_LABEL_KEY[s]]}
          {isNeutral(s) && <span className="sr-only">(neutral)</span>}
        </span>
      ))}
    </div>
  );
}

// Variant — "Cards".
//
// Same spine as Roster (one ROW per context group, contexts laid out inline
// inside it), but the opposite end of the density/information trade-off: each
// context is a small CARD rather than a pill. A card leads with a KPI health
// bar, then the name, then a full stat line — files · features · goals · ideas ·
// KPIs — so a context is legible without opening anything. The surface is tinted
// by the same worst-wins KPI rollup, neutral when there are no KPIs or no
// readings yet.
//
// Fewer contexts fit per row than Roster, and that is the point: Roster is for
// sweeping a 260-context map for red; Cards is for actually reading a group.
import { useMemo, useState } from 'react';
import { FileCode2, Gauge, Layers, Lightbulb, Search, Target } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
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

export default function ContextGroupRowsCards(props: ContextLedgerProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.plugins.dev_tools;
  const {
    groups,
    useCaseState,
    selectedUseCaseId,
    selectedCtxId,
    onSelectCtx,
    goalCoverageByContext,
    ideaCoverageByContext,
    kpiCoverageByContext,
    kpiStatusByContext,
    hasMap,
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
            <div key={g.id} className="px-3 py-2.5">
              {/* the group heads its own row */}
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot.bg}`} />
                <span className="typo-title">{g.name}</span>
                <span className="typo-caption text-foreground/50 tabular-nums">{g.contexts.length}</span>
              </div>

              {/* its contexts, as cards, inline */}
              <div className="flex flex-wrap gap-1.5">
                {g.contexts.map((c) => {
                  const status = statusOf(c.id);
                  const selected = c.id === selectedCtxId;
                  const dimmed = highlighted.size > 0 && !highlighted.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectCtx(selected ? null : c.id)}
                      className={`w-[13.5rem] text-left rounded-card border p-2 transition-colors ${
                        KPI_STATUS_SURFACE[status]
                      } ${selected ? 'ring-1 ring-primary/60' : ''} ${dimmed ? 'opacity-35' : ''}`}
                    >
                      {/* health bar — the card's headline */}
                      <Tooltip content={t[KPI_STATUS_LABEL_KEY[status]]}>
                        <span className={`block h-1 w-full rounded-full mb-1.5 ${KPI_STATUS_DOT[status]}`} />
                      </Tooltip>

                      <span className="block typo-body font-medium text-foreground truncate mb-1">
                        {c.name}
                      </span>

                      <span className="flex items-center gap-2 typo-caption">
                        <Stat icon={<FileCode2 className="w-3 h-3" />} n={c.filePaths.length} stem="text-foreground/70" />
                        <Stat icon={<Layers className="w-3 h-3" />} n={featureCountByContext.get(c.id) ?? 0} stem="text-sky-300" />
                        <Stat icon={<Target className="w-3 h-3" />} n={goalCoverageByContext.get(c.id)?.count ?? 0} stem="text-violet-300" />
                        <Stat icon={<Lightbulb className="w-3 h-3" />} n={ideaCoverageByContext.get(c.id) ?? 0} stem="text-amber-300" />
                        <Stat icon={<Gauge className="w-3 h-3" />} n={kpiCoverageByContext.get(c.id) ?? 0} stem="text-rose-300" />
                      </span>
                    </button>
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

/** One stat on a card — muted to nothing when the count is zero, so a card's
 *  colour comes from what it actually has. */
function Stat({ icon, n, stem }: { icon: React.ReactNode; n: number; stem: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${n > 0 ? stem : 'text-foreground/25'}`}>
      {icon}
      {n}
    </span>
  );
}

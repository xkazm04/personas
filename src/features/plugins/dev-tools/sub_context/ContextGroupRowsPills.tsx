// Variant — "Roster".
//
// Mental model: a team sheet. One ROW per context group; the group's contexts
// are laid out inline inside it as compact pills that wrap. The pill's surface
// is tinted by its KPI health (neutral when a context has no KPIs, or KPIs with
// no readings — an unmeasured context has earned no colour), so the whole map
// reads as a field of health at a glance and a red pill is findable in one
// sweep.
//
// This is the DENSITY end of the pair: a pill carries only what fits on one
// line — name, a health dot, and its feature count — so a group of 40 contexts
// still fits in a couple of wrapped lines. Everything else is one click away in
// the detail pane.
import { useMemo, useState } from 'react';
import { Layers, Search } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { colorDot } from './GroupColorPicker';
import {
  LedgerActions,
  ProposalStrip,
  type ContextLedgerProps,
} from './contextLedgerShared';
import {
  KPI_STATUS_SURFACE,
  KPI_STATUS_DOT,
  KPI_STATUS_LABEL_KEY,
  isNeutral,
  type ContextKpiStatus,
} from './contextKpiStatus';

export default function ContextGroupRowsPills(props: ContextLedgerProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.plugins.dev_tools;
  const {
    groups,
    useCaseState,
    selectedUseCaseId,
    selectedCtxId,
    onSelectCtx,
    kpiStatusByContext,
    hasMap,
  } = props;

  const [query, setQuery] = useState('');

  const contextNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const c of g.contexts) m.set(c.id, c.name);
    return m;
  }, [groups]);

  // Contexts spanned by the selected feature — the slice, highlighted in place.
  const highlighted = useMemo(() => {
    const uc = useCaseState.useCases.find((u) => u.id === selectedUseCaseId);
    return new Set(uc?.context_ids ?? []);
  }, [useCaseState.useCases, selectedUseCaseId]);

  // How many features slice through each context — the pill's one stat.
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
              <div className="flex items-center gap-1.5 shrink-0 w-44 pt-1">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot.bg}`} />
                <span className="typo-title truncate">{g.name}</span>
                <span className="typo-caption text-foreground/50 tabular-nums shrink-0">
                  {g.contexts.length}
                </span>
              </div>

              {/* its contexts, inline */}
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {g.contexts.map((c) => {
                  const status = statusOf(c.id);
                  const selected = c.id === selectedCtxId;
                  const dimmed = highlighted.size > 0 && !highlighted.has(c.id);
                  const features = featureCountByContext.get(c.id) ?? 0;
                  return (
                    <Tooltip
                      key={c.id}
                      content={`${c.name} · ${t[KPI_STATUS_LABEL_KEY[status]]}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectCtx(selected ? null : c.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 typo-caption transition-colors ${
                          KPI_STATUS_SURFACE[status]
                        } ${selected ? 'ring-1 ring-primary/60' : ''} ${dimmed ? 'opacity-35' : ''}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KPI_STATUS_DOT[status]}`} />
                        <span className="truncate max-w-[13rem] text-foreground">{c.name}</span>
                        {features > 0 && (
                          <span className="tabular-nums text-foreground/60 border-l border-foreground/15 pl-1.5">
                            {features}
                          </span>
                        )}
                      </button>
                    </Tooltip>
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

/** The colour key — without it, a tinted board is a guessing game. */
export function KpiLegend({ t }: { t: ReturnType<typeof useTranslation>['t']['plugins']['dev_tools'] }) {
  const shown: ContextKpiStatus[] = ['met', 'on-track', 'off-track', 'unmeasured'];
  return (
    <div className="hidden lg:flex items-center gap-2.5 shrink-0 ml-auto mr-1">
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

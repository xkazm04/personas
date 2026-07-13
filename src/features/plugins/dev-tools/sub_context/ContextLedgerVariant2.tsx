// Variant 2 — "Ledger".
//
// Mental model: an accounting ledger, use-case-first. Each ACTIVE use case is a
// record row; the contexts it slices through are its line items, rendered inline
// as group-tinted chips (primary context ringed). A right-hand "reach" column
// rolls up what the whole slice touches — files, goals, ideas, KPIs — so a use
// case reads as "this outcome, spanning these areas, touching this much work".
// Below the entries sits the ledger's other half: UNCLAIMED contexts — code no
// outcome has named yet — so the gap the layer exists to close is always in
// view. The N:M relation shows up as the same context chip recurring across
// rows; the emphasis is inverted from Variant 1 (records over grid).
import { useMemo } from 'react';
import { Layers, FileCode2, Target, Lightbulb, Gauge, ChevronRight } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { colorDot } from './GroupColorPicker';
import type { ContextItem } from './contextMapTypes';
import {
  LedgerActions,
  ProposalStrip,
  kindMeta,
  KIND_TEXT,
  KIND_CHIP,
  type ContextLedgerProps,
  type TDevTools,
} from './contextLedgerShared';

interface Reach {
  files: number;
  goals: number;
  ideas: number;
  kpis: number;
}

export default function ContextLedgerVariant2(props: ContextLedgerProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.plugins.dev_tools as unknown as TDevTools;
  const {
    groups,
    useCaseState,
    selectedUseCaseId,
    onSelectUseCase,
    selectedCtxId,
    onSelectCtx,
    goalCoverageByContext,
    ideaCoverageByContext,
    kpiCoverageByContext,
    hasMap,
  } = props;

  // context id → { ctx, groupColor } for chip rendering + reach rollups.
  const ctxIndex = useMemo(() => {
    const m = new Map<string, { ctx: ContextItem; color: string }>();
    for (const g of groups) for (const c of g.contexts) m.set(c.id, { ctx: c, color: g.color });
    return m;
  }, [groups]);

  const active = useCaseState.active;

  const reachOf = (ids: string[]): Reach =>
    ids.reduce<Reach>(
      (acc, id) => {
        const entry = ctxIndex.get(id);
        acc.files += entry?.ctx.filePaths.length ?? 0;
        acc.goals += goalCoverageByContext.get(id)?.count ?? 0;
        acc.ideas += ideaCoverageByContext.get(id) ?? 0;
        acc.kpis += kpiCoverageByContext.get(id) ?? 0;
        return acc;
      },
      { files: 0, goals: 0, ideas: 0, kpis: 0 },
    );

  // Contexts claimed by at least one active use case vs. the unclaimed remainder.
  const claimed = useMemo(() => {
    const s = new Set<string>();
    for (const uc of active) for (const id of uc.context_ids) s.add(id);
    return s;
  }, [active]);

  const unclaimedByGroup = useMemo(
    () =>
      groups
        .map((g) => ({ group: g, contexts: g.contexts.filter((c) => !claimed.has(c.id)) }))
        .filter((g) => g.contexts.length > 0),
    [groups, claimed],
  );
  const totalContexts = useMemo(() => groups.reduce((n, g) => n + g.contexts.length, 0), [groups]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* header actions */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="typo-section-title flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t.uc_title}
          {active.length > 0 && (
            <span className="typo-caption text-foreground tabular-nums">
              ({active.length} · {claimed.size}/{totalContexts})
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          <LedgerActions state={useCaseState} hasMap={hasMap} t={t} />
        </div>
      </div>

      <ProposalStrip proposals={useCaseState.proposed} onAccept={useCaseState.accept} onReject={useCaseState.reject} t={t} tx={tx} />

      <div className="rounded-card border border-primary/10 overflow-auto min-h-0 flex-1 divide-y divide-primary/[0.07]">
        {/* use-case entries */}
        {active.map((uc) => {
          const meta = kindMeta(uc.kind);
          const Icon = meta.icon;
          const selected = uc.id === selectedUseCaseId;
          const reach = reachOf(uc.context_ids);
          return (
            <div
              key={uc.id}
              className={`px-3 py-2 transition-colors ${selected ? 'bg-primary/[0.08]' : 'hover:bg-secondary/10'}`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectUseCase(selected ? null : uc.id)}
                  aria-pressed={selected}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  <span className={`grid place-items-center w-6 h-6 rounded-input shrink-0 ${KIND_CHIP[meta.stem]}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="typo-body font-medium text-foreground truncate">{uc.name}</span>
                  <span className={`typo-caption shrink-0 ${KIND_TEXT[meta.stem]}`}>{t[meta.labelKey]}</span>
                  <span className="typo-caption text-foreground/50 tabular-nums shrink-0">
                    {tx(t.uc_span_count, { count: uc.context_ids.length })}
                  </span>
                </button>

                {/* reach — what this whole slice touches */}
                <span className="flex items-center gap-3 shrink-0">
                  <ReachStat icon={<FileCode2 className="w-3 h-3" />} value={reach.files} tip={`${reach.files} ${t.files}`} stem="text-foreground/70" />
                  <ReachStat icon={<Target className="w-3 h-3" />} value={reach.goals} tip={`${reach.goals} goals`} stem="text-violet-300" />
                  <ReachStat icon={<Lightbulb className="w-3 h-3" />} value={reach.ideas} tip={`${reach.ideas} ideas`} stem="text-amber-300" />
                  <ReachStat icon={<Gauge className="w-3 h-3" />} value={reach.kpis} tip={`${reach.kpis} KPIs`} stem="text-rose-300" />
                </span>
              </div>

              {/* line items — the contexts this use case spans */}
              <div className="flex flex-wrap gap-1 mt-1.5 pl-8">
                {uc.context_ids.map((cid) => {
                  const entry = ctxIndex.get(cid);
                  if (!entry) return null;
                  const dot = colorDot(entry.color);
                  const isPrimary = uc.primary_context_id === cid;
                  const ctxSelected = cid === selectedCtxId;
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => onSelectCtx(ctxSelected ? null : cid)}
                      title={isPrimary ? `${entry.ctx.name} · primary` : entry.ctx.name}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 typo-caption transition-colors ${
                        ctxSelected
                          ? 'border-primary/50 bg-primary/15 text-foreground'
                          : 'border-primary/10 bg-card/40 text-foreground hover:border-primary/30'
                      } ${isPrimary ? 'ring-1 ring-primary/30' : ''}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${dot.bg}`} />
                      <span className="truncate max-w-[12rem]">{entry.ctx.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {active.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center px-6">
            <Layers className="w-7 h-7 text-primary/40" />
            <p className="typo-body font-medium text-foreground">{t.uc_empty ?? 'No use cases yet'}</p>
            <p className="typo-caption text-foreground/60 max-w-sm">
              {hasMap ? (t.uc_scan_tooltip ?? '') : (t.uc_empty_no_map ?? '')}
            </p>
          </div>
        )}

        {/* the other half of the ledger: unclaimed contexts */}
        {unclaimedByGroup.length > 0 && (
          <div className="bg-secondary/[0.06]">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/5">
              <ChevronRight className="w-3.5 h-3.5 text-foreground/40" />
              <span className="typo-label text-foreground/60">Unclaimed contexts</span>
              <span className="typo-caption text-foreground/40 tabular-nums">
                {totalContexts - claimed.size}
              </span>
              <Tooltip content="Contexts no active use case covers yet — code without a named outcome.">
                <span className="typo-caption text-foreground/40 italic ml-1 hidden sm:inline">no outcome yet</span>
              </Tooltip>
            </div>
            {unclaimedByGroup.map(({ group, contexts }) => {
              const dot = colorDot(group.color);
              return (
                <div key={group.id} className="flex items-start gap-2 px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5 shrink-0 pt-0.5 w-40">
                    <span className={`w-2 h-2 rounded-full ${dot.bg}`} />
                    <span className="typo-caption text-foreground/70 truncate">{group.name}</span>
                  </span>
                  <div className="flex flex-wrap gap-1 flex-1">
                    {contexts.map((c) => {
                      const ctxSelected = c.id === selectedCtxId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onSelectCtx(ctxSelected ? null : c.id)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 typo-caption transition-colors ${
                            ctxSelected
                              ? 'border-primary/50 bg-primary/15 text-foreground'
                              : 'border-dashed border-foreground/15 text-foreground/60 hover:border-primary/30 hover:text-foreground'
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ReachStat({ icon, value, tip, stem }: { icon: React.ReactNode; value: number; tip: string; stem: string }) {
  const active = value > 0;
  return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1 typo-caption tabular-nums ${active ? stem : 'text-foreground/25'}`}>
        {icon}
        <Numeric value={value} />
      </span>
    </Tooltip>
  );
}

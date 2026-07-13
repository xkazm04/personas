// Variant 1 — "Cross-tab".
//
// Mental model: a spreadsheet cross-tabulation. Rows are contexts (wrapped in
// their group bands, like the Factory matrix); COLUMNS are the active use cases.
// A filled cell means "this use case slices through this context" — so you read
// DOWN a column to see a use case's whole slice, and ACROSS a row to see which
// use cases touch a context. The N:M relationship becomes a shape you can see
// at a glance instead of a set of chips you have to cross-reference. The left
// gutter carries each context's real coverage (files · use cases · goals ·
// ideas · KPIs) so a row is a full record, not just a label.
import { useMemo } from 'react';
import { Layers } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { colorDot } from './GroupColorPicker';
import {
  ContextCoverage,
  LedgerActions,
  ProposalStrip,
  kindMeta,
  KIND_DOT,
  KIND_TEXT,
  type ContextLedgerProps,
  type TDevTools,
} from './contextLedgerShared';

export default function ContextLedgerVariant1(props: ContextLedgerProps) {
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

  const cols = useCaseState.active;
  // Fast membership test per (useCase, context).
  const memberSets = useMemo(
    () => cols.map((uc) => ({ uc, set: new Set(uc.context_ids) })),
    [cols],
  );

  // Grid: context record (name + coverage) then one narrow column per use case.
  const gridTemplate = `minmax(280px, 1.6fr) repeat(${cols.length}, 34px)`;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* header actions */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="typo-section-title flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t.uc_title}
          {cols.length > 0 && (
            <span className="typo-caption text-foreground tabular-nums">({cols.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          <LedgerActions state={useCaseState} hasMap={hasMap} t={t} />
        </div>
      </div>

      <ProposalStrip proposals={useCaseState.proposed} onAccept={useCaseState.accept} onReject={useCaseState.reject} t={t} tx={tx} />

      <div className="rounded-card border border-primary/10 overflow-auto min-h-0 flex-1">
        {/* column header — one clickable cell per use case */}
        <div
          className="grid items-end gap-0 px-3 py-2 bg-secondary/20 border-b border-primary/10 sticky top-0 z-10 backdrop-blur"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="typo-label text-foreground/60">Context</span>
          {cols.length === 0 ? (
            <span className="typo-caption text-foreground/40 pl-2">—</span>
          ) : (
            memberSets.map(({ uc }) => {
              const meta = kindMeta(uc.kind);
              const Icon = meta.icon;
              const selected = uc.id === selectedUseCaseId;
              return (
                <Tooltip key={uc.id} content={`${uc.name} · ${tx(t.uc_span_count, { count: uc.context_ids.length })}`}>
                  <button
                    type="button"
                    onClick={() => onSelectUseCase(selected ? null : uc.id)}
                    aria-pressed={selected}
                    className={`h-full flex items-start justify-center pt-0.5 rounded-t transition-colors ${
                      selected ? 'bg-primary/15' : 'hover:bg-secondary/40'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${KIND_TEXT[meta.stem]}`} />
                  </button>
                </Tooltip>
              );
            })
          )}
        </div>

        {/* group bands + context rows */}
        {groups.map((g) => {
          const dot = colorDot(g.color);
          return (
            <div key={g.id}>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/10 border-b border-primary/5">
                <span className={`w-2.5 h-2.5 rounded-full ${dot.bg}`} />
                <span className="typo-title">{g.name}</span>
                <span className="typo-caption text-foreground/50 tabular-nums">{g.contexts.length}</span>
              </div>

              <div className="divide-y divide-primary/5">
                {g.contexts.map((c) => {
                  const selected = c.id === selectedCtxId;
                  return (
                    <div
                      key={c.id}
                      className={`grid items-center gap-0 px-3 py-1 transition-colors ${
                        selected ? 'bg-primary/10' : 'hover:bg-secondary/10'
                      }`}
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      {/* the context record */}
                      <div className="flex items-center gap-2.5 min-w-0 pr-3">
                        <button
                          type="button"
                          onClick={() => onSelectCtx(selected ? null : c.id)}
                          className="typo-body font-medium text-foreground truncate text-left hover:text-primary"
                        >
                          {c.name}
                        </button>
                        <span className="ml-auto shrink-0">
                          <ContextCoverage
                            fileCount={c.filePaths.length}
                            useCaseCount={memberSets.filter((m) => m.set.has(c.id)).length}
                            goalCount={goalCoverageByContext.get(c.id)?.count ?? 0}
                            ideaCount={ideaCoverageByContext.get(c.id) ?? 0}
                            kpiCount={kpiCoverageByContext.get(c.id) ?? 0}
                            t={t}
                          />
                        </span>
                      </div>

                      {/* membership cells */}
                      {memberSets.map(({ uc, set }) => {
                        const isMember = set.has(c.id);
                        const isPrimary = uc.primary_context_id === c.id;
                        const meta = kindMeta(uc.kind);
                        const colSelected = uc.id === selectedUseCaseId;
                        return (
                          <span
                            key={uc.id}
                            className={`flex items-center justify-center h-full ${colSelected ? 'bg-primary/[0.07]' : ''}`}
                          >
                            {isMember ? (
                              <span
                                className={`rounded-full ${KIND_DOT[meta.stem]} ${
                                  isPrimary ? 'w-2.5 h-2.5 ring-2 ring-offset-1 ring-offset-transparent ring-primary/40' : 'w-2 h-2 opacity-80'
                                }`}
                              />
                            ) : (
                              <span className="w-1 h-1 rounded-full bg-foreground/10" />
                            )}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {cols.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center px-6">
            <Layers className="w-7 h-7 text-primary/40" />
            <p className="typo-body font-medium text-foreground">{t.uc_empty ?? 'No use cases yet'}</p>
            <p className="typo-caption text-foreground/60 max-w-sm">
              {hasMap ? (t.uc_scan_tooltip ?? '') : (t.uc_empty_no_map ?? '')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

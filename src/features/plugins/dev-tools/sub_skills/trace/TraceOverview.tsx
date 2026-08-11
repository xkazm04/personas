// Level 1 — the Ember Matrix, "Ruled" finish (prototype winner, 2026-08-09):
// workspace-library skills × projects as an ember grid on a drafting table —
// framed card, ruled rows with zebra striping, sticky header band, version
// column, per-project 30-day totals footer, tier legend. Rows ranked by
// recency-weighted heat (hottest first — the ranking IS the story); click a
// row or cell → the skill tree (Level 2).
import { useMemo } from 'react';

import { Globe, Info, Network } from 'lucide-react';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import { TraceEmberCell } from './TraceEmberCell';
import { TraceGhosts } from './TraceGhosts';
import type { HeatTier, TraceModel } from './traceTypes';

export interface TraceOverviewProps {
  model: TraceModel;
  onSelectSkill: (skill: string) => void;
  onOpenInfo: (skill: string) => void;
}

const TIER_SWATCH: Record<HeatTier, string> = {
  hot: 'bg-primary opacity-90',
  warm: 'bg-primary opacity-60',
  cool: 'bg-primary opacity-30',
  cold: 'border border-dashed border-foreground/40',
  absent: 'bg-foreground/15',
};

export function TraceOverview({ model, onSelectSkill, onOpenInfo }: TraceOverviewProps) {
  const { t, tx } = useTranslation();
  const reveal = useRevealTracker(model.header?.id);
  const showGhost = model.loading && model.skills.length === 0;
  const settledEmpty = !model.loading && model.skills.length === 0;

  const columnTotals = useMemo(
    () => model.projects.map((p) => model.skills.reduce((n, s) => n + model.cell(s.name, p.id).invokes30d, 0)),
    [model],
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex flex-col min-h-0 flex-1 rounded-card border border-border/60 bg-secondary/[0.15] overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-secondary/90 backdrop-blur-sm">
                <th className="text-left typo-caption text-foreground font-medium px-3 py-2 border-b-2 border-border">
                  {tx(t.plugins.dev_tools.trace_skills_count, { count: model.skills.length })}
                </th>
                <th className="typo-caption text-foreground font-medium pr-2 py-2 border-b-2 border-border text-right w-12">v</th>
                {model.projects.map((p) => (
                  <th key={p.id} className="typo-caption text-foreground font-medium px-1 py-2 border-b-2 border-border border-l border-border/20 max-w-[76px]">
                    <span className="block truncate" title={p.name}>{p.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showGhost ? (
                <tr><td colSpan={model.projects.length + 2} className="p-3"><TraceGhosts columns={model.projects.length} /></td></tr>
              ) : (
                model.skills.map((s, rowIdx) => {
                  // Icon encodes the METHOD's scope, not the skill's brand:
                  // context-tracked (walks the context map) vs agnostic.
                  const Icon = s.contextTracked ? Network : Globe;
                  return (
                    <RevealItem
                      key={s.name}
                      as="tr"
                      revealId={s.name}
                      order={rowIdx}
                      hasEntered={reveal.hasEntered}
                      markEntered={reveal.markEntered}
                      className={`group ${rowIdx % 2 === 1 ? 'bg-secondary/25' : ''} hover:bg-primary/5 transition-colors`}
                    >
                      <td className="px-3 py-1 border-b border-border/40">
                        <div className="flex items-center gap-2 min-w-48">
                          <button
                            type="button"
                            onClick={() => onSelectSkill(s.name)}
                            className="flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
                            title={s.contextTracked ? t.plugins.dev_tools.skills_info_context_tracked : undefined}
                          >
                            <Icon size={16} style={s.visual ? { color: s.visual.color } : undefined} className="shrink-0" />
                            <span className="typo-body truncate">{s.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenInfo(s.name)}
                            aria-label={t.plugins.dev_tools.trace_open_info}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-foreground transition-opacity ml-auto"
                          >
                            <Info size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="pr-2 py-1 border-b border-border/40 text-right">
                        <span className="typo-data tabular-nums">{s.libraryVersion ?? '1.0'}</span>
                      </td>
                      {model.projects.map((p) => {
                        const cell = model.cell(s.name, p.id);
                        // Version drift, at the cell: when this project's copy
                        // differs from the library, its own version sits next
                        // to the ember in quiet gray — full opacity on hover
                        // (operator-specified affordance).
                        const mismatch = cell.adopted
                          && (cell.installedVersion ?? '1.0') !== (s.libraryVersion ?? '1.0');
                        return (
                          <td key={p.id} className="text-center py-1 border-b border-border/40 border-l border-border/20">
                            <span className="inline-flex items-center">
                              <TraceEmberCell cell={cell} accent={s.visual?.color ?? null} onClick={() => onSelectSkill(s.name)} />
                              {mismatch && (
                                <span className="typo-label tabular-nums text-foreground opacity-40 hover:opacity-100 transition-opacity -ml-0.5">
                                  {cell.installedVersion ?? '1.0'}
                                </span>
                              )}
                            </span>
                          </td>
                        );
                      })}
                    </RevealItem>
                  );
                })
              )}
            </tbody>
            {!showGhost && !settledEmpty && (
              <tfoot>
                <tr className="bg-secondary/60">
                  <td className="px-3 py-1.5 typo-caption text-foreground text-right" colSpan={2}>30d</td>
                  {columnTotals.map((n, i) => (
                    <td key={model.projects[i]?.id ?? i} className="text-center typo-data tabular-nums py-1.5 border-l border-border/20">
                      {n > 0 ? n : <span aria-hidden>·</span>}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          {settledEmpty && (
            <div className="py-10">
              <IllustratedEmptyState variant="heatmap" heading={t.plugins.dev_tools.trace_empty_title} description={t.plugins.dev_tools.trace_empty_hint} />
            </div>
          )}
        </div>
      </div>

      {/* tier legend */}
      <div className="flex items-center gap-4 pt-2">
        {(['hot', 'warm', 'cool', 'cold', 'absent'] as HeatTier[]).map((tier) => (
          <Tooltip key={tier} content={t.plugins.dev_tools[`trace_tier_${tier}_hint` as const]}>
            <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${TIER_SWATCH[tier]}`} />
              {t.plugins.dev_tools[`trace_tier_${tier}` as const]}
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

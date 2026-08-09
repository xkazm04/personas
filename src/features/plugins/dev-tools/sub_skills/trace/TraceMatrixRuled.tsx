// RESTYLE "Ruled" — the Ember Matrix on a drafting table. Same view mode as
// the baseline (skills × projects ember grid, heat-ranked) finished as a
// precise instrument: framed card, ruled row lines, zebra stripes, a sticky
// header band, and a per-project totals footer so columns read as columns.
import { Flame, Info } from 'lucide-react';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import { TraceEmberCell } from './TraceEmberCell';
import { TraceGhosts } from './TraceGhosts';
import type { TraceOverviewProps } from './TraceOverview';

export function TraceMatrixRuled({ model, onSelectSkill, onOpenInfo }: TraceOverviewProps) {
  const { t, tx } = useTranslation();
  const showGhost = model.loading && model.skills.length === 0;
  const settledEmpty = !model.loading && model.skills.length === 0;

  const columnTotals = model.projects.map((p) =>
    model.skills.reduce((n, s) => n + model.cell(s.name, p.id).invokes30d, 0));

  return (
    <div className="flex flex-col min-h-0 h-full rounded-card border border-border/60 bg-secondary/[0.15] overflow-hidden">
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-secondary/90 backdrop-blur-sm">
              <th className="text-left typo-caption text-foreground font-medium px-3 py-2 border-b-2 border-border">
                {tx(t.plugins.dev_tools.trace_skills_count, { count: model.skills.length })}
              </th>
              <th className="typo-caption text-foreground font-medium px-2 py-2 border-b-2 border-border text-right w-14">v</th>
              {model.projects.map((p) => (
                <th key={p.id} className="typo-caption text-foreground font-medium px-1 py-2 border-b-2 border-border max-w-[76px]">
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
                const Icon = s.visual?.icon ?? Flame;
                return (
                  <tr key={s.name} className={`group ${rowIdx % 2 === 1 ? 'bg-secondary/25' : ''} hover:bg-primary/5 transition-colors`}>
                    <td className="px-3 py-1 border-b border-border/40">
                      <div className="flex items-center gap-2 min-w-48">
                        <button type="button" onClick={() => onSelectSkill(s.name)} className="flex items-center gap-2 min-w-0 hover:text-primary transition-colors">
                          <Icon size={14} style={s.visual ? { color: s.visual.color } : undefined} className="shrink-0" />
                          <span className="typo-body truncate">{s.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenInfo(s.name)}
                          aria-label={t.plugins.dev_tools.trace_open_info}
                          className="opacity-0 group-hover:opacity-100 text-foreground transition-opacity ml-auto"
                        >
                          <Info size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1 border-b border-border/40 text-right">
                      <span className="typo-data tabular-nums">{s.libraryVersion ?? '1.0'}</span>
                    </td>
                    {model.projects.map((p, i) => (
                      <td key={p.id} className={`text-center py-1 border-b border-border/40 ${i > 0 ? 'border-l border-border/20' : 'border-l border-border/20'}`}>
                        <TraceEmberCell cell={model.cell(s.name, p.id)} accent={s.visual?.color ?? null} onClick={() => onSelectSkill(s.name)} />
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {!showGhost && !settledEmpty && (
            <tfoot>
              <tr className="bg-secondary/60">
                <td className="px-3 py-1.5 typo-caption text-foreground" colSpan={2}>30d</td>
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
  );
}

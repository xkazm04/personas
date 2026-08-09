// VARIANT "Ledger" — an engineering record. Mental model: the workspace's
// skill register as a dense, ruled ledger: one line per skill with version,
// a segmented adoption gauge (one segment per project, filled by heat),
// exact run counts and the freshest-run clock in tabular figures. Reads as
// "the audited state of the library", vs the baseline's exploratory matrix.
import { Flame } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { TraceGhosts } from './TraceGhosts';
import type { TraceOverviewProps } from './TraceOverview';
import type { TraceCell, TraceProject } from './traceTypes';

/** One 8×18 gauge segment per project — the matrix row at ledger density. */
function AdoptionGauge({ projects, cells, accent }: {
  projects: TraceProject[];
  cells: TraceCell[];
  accent: string | null;
}) {
  return (
    <span className="inline-flex items-end gap-[3px] h-[18px]">
      {projects.map((p, i) => {
        const cell = cells[i];
        if (!cell) return null;
        const fill = cell.tier === 'absent'
          ? <span className="inline-block w-2 h-[3px] rounded-interactive bg-foreground/15" />
          : cell.tier === 'cold'
            ? <span className="inline-block w-2 h-2 rounded-interactive border border-dashed border-foreground/40" />
            : (
              <span
                className="inline-block w-2 rounded-interactive"
                style={{
                  height: `${6 + Math.round(cell.heat * 12)}px`,
                  background: accent ?? 'currentColor',
                  opacity: 0.35 + 0.6 * cell.heat,
                }}
              />
            );
        return <Tooltip key={p.id} content={p.name}>{fill}</Tooltip>;
      })}
    </span>
  );
}

export function TraceLedger({ model, onSelectSkill, onOpenInfo }: TraceOverviewProps) {
  const { t, tx } = useTranslation();
  if (model.loading && model.skills.length === 0) return <TraceGhosts columns={4} />;

  return (
    <div className="overflow-auto pr-1">
      <div className="grid grid-cols-[minmax(0,1.5fr)_4rem_minmax(8rem,1fr)_5rem_6.5rem] items-center gap-3 border-b border-border pb-1.5">
        <span className="typo-caption text-foreground">{tx(t.plugins.dev_tools.trace_skills_count, { count: model.skills.length })}</span>
        <span className="typo-caption text-foreground text-right">v</span>
        <span className="typo-caption text-foreground">{tx(t.plugins.dev_tools.trace_summary, { projects: model.projects.length })}</span>
        <span className="typo-caption text-foreground text-right">30d</span>
        <span className="typo-caption text-foreground text-right">{t.plugins.dev_tools.trace_cell_last_run}</span>
      </div>
      <ul>
        {model.skills.map((s) => {
          const Icon = s.visual?.icon ?? Flame;
          const cells = model.projects.map((p) => model.cell(s.name, p.id));
          const freshest = cells.reduce<number | null>(
            (acc, c) => (c.lastInvokedAt != null && (acc == null || c.lastInvokedAt > acc) ? c.lastInvokedAt : acc),
            null,
          );
          return (
            <li
              key={s.name}
              className="grid grid-cols-[minmax(0,1.5fr)_4rem_minmax(8rem,1fr)_5rem_6.5rem] items-center gap-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-secondary/40 transition-colors"
            >
              <button type="button" onClick={() => onSelectSkill(s.name)} className="flex items-center gap-2 min-w-0 text-left hover:text-primary transition-colors">
                <Icon size={14} style={s.visual ? { color: s.visual.color } : undefined} className="shrink-0" />
                <span className="typo-body truncate">{s.name}</span>
              </button>
              <button type="button" onClick={() => onOpenInfo(s.name)} className="typo-data tabular-nums text-right hover:text-primary transition-colors">
                {s.libraryVersion ?? '1.0'}
              </button>
              <AdoptionGauge projects={model.projects} cells={cells} accent={s.visual?.color ?? null} />
              <span className="typo-data tabular-nums text-right">{s.totalInvokes}</span>
              <span className="typo-caption text-foreground text-right">
                {freshest != null ? <RelativeTime timestamp={freshest} showTooltip={false} /> : <span aria-hidden>—</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

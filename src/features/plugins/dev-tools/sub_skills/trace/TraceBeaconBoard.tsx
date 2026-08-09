// VARIANT "Beacon Board" — mission-control tiles. Mental model: each
// workspace skill is a BEACON with its own card: a large 30-day run count,
// adoption fraction, freshest-run clock, and the per-project ember strip
// folded inside. Reads as "which beacons are lit", vs the baseline's
// cross-project matrix scan. Tiles rank by heat, hottest first.
import { Flame } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { TraceEmberCell } from './TraceEmberCell';
import { TraceGhosts } from './TraceGhosts';
import type { TraceOverviewProps } from './TraceOverview';

export function TraceBeaconBoard({ model, onSelectSkill, onOpenInfo }: TraceOverviewProps) {
  const { t, tx } = useTranslation();
  const showGhost = model.loading && model.skills.length === 0;

  if (showGhost) return <TraceGhosts columns={4} />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 overflow-auto pr-1 content-start">
      {model.skills.map((s) => {
        const Icon = s.visual?.icon ?? Flame;
        const cells = model.projects.map((p) => ({ p, cell: model.cell(s.name, p.id) }));
        const freshest = cells.reduce<number | null>(
          (acc, { cell }) => (cell.lastInvokedAt != null && (acc == null || cell.lastInvokedAt > acc) ? cell.lastInvokedAt : acc),
          null,
        );
        return (
          <div
            key={s.name}
            role="button"
            tabIndex={0}
            onClick={() => onSelectSkill(s.name)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelectSkill(s.name); }}
            className="cursor-pointer text-left rounded-card border border-border/50 bg-secondary/30 hover:border-primary/40 hover:shadow-elevation-2 transition-all p-3 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <Icon size={16} style={s.visual ? { color: s.visual.color } : undefined} className="shrink-0" />
              <span className="typo-body font-medium truncate">{s.name}</span>
              <span
                className="typo-caption tabular-nums ml-auto shrink-0 px-1.5 rounded-interactive bg-secondary/80"
                onClick={(e) => { e.stopPropagation(); onOpenInfo(s.name); }}
              >
                v{s.libraryVersion ?? '1.0'}
              </span>
            </div>

            <div className="flex items-end gap-3">
              <span className="typo-data-lg tabular-nums leading-none">{s.totalInvokes}</span>
              <span className="typo-caption text-foreground pb-0.5">
                {tx(t.plugins.dev_tools.trace_cell_invokes, { count: s.totalInvokes })}
              </span>
              {freshest != null && (
                <span className="typo-caption text-foreground pb-0.5 ml-auto inline-flex gap-1">
                  {t.plugins.dev_tools.trace_cell_last_run}
                  <RelativeTime timestamp={freshest} showTooltip={false} />
                </span>
              )}
            </div>

            {/* per-project ember strip — the matrix row, folded into the tile */}
            <div className="flex items-center gap-0.5 flex-wrap">
              {cells.map(({ p, cell }) => (
                <span key={p.id} title={p.name} className="inline-flex">
                  <TraceEmberCell cell={cell} accent={s.visual?.color ?? null} onClick={() => onSelectSkill(s.name)} />
                </span>
              ))}
              <span className="typo-caption text-foreground tabular-nums ml-auto">
                {s.adoptedCount}/{model.projects.length}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

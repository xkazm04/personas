// One card of the grid. Every card is IDENTICAL in structure — header, share
// bar, coverage line, group chips — because a small multiple only reads if the
// eye can move between cards without re-learning the mark.
import { useTranslation } from '@/i18n/useTranslation';
import { bandFill, HATCH_BG } from '../kpiChartTheme';
import { BAND_COLOR, UNGROUPED_KEY, type KpiFocus, type KpiProjectRollup } from '../kpiOverviewModel';
import { stackShares } from './ProjectGrid.model';
import { GridCoverageSpark, GridStackBar } from './ProjectGridStack';

/** Chips shown before the overflow chip takes over. */
const CHIP_LIMIT = 8;

export function ProjectGridCard({
  project,
  coverage,
  sparkGhost,
  onFocus,
}: {
  project: KpiProjectRollup;
  coverage: number[];
  sparkGhost: boolean;
  onFocus: (focus: KpiFocus) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const counts = tx(o.grid_stack_aria, {
    met: project.met,
    onTrack: project.onTrack,
    offTrack: project.offTrack,
    unmeasured: project.total - project.measured,
    total: project.total,
  });
  const shown = project.groups.slice(0, CHIP_LIMIT);
  const rest = project.groups.length - shown.length;
  const openProject = () => onFocus({ projectId: project.projectId, groupId: null });

  return (
    <div
      className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-2.5"
      data-testid={`kpi-grid-card-${project.projectId}`}
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          className="typo-title text-foreground text-left truncate hover:text-primary focus-ring rounded-interactive"
          aria-label={tx(o.lane_open, { project: project.label })}
          onClick={openProject}
        >
          {project.label}
        </button>
        <span
          className="typo-label rounded-pill px-2 py-0.5 text-foreground flex-shrink-0"
          style={
            project.band === 'unmeasured'
              ? { background: HATCH_BG }
              : { background: bandFill(BAND_COLOR[project.band], project.coverage) }
          }
        >
          {o.band_labels[project.band]}
        </span>
        {/* muted-ok: structural denominator beside the title */}
        <span className="typo-caption text-muted-foreground ml-auto flex-shrink-0">
          {tx(o.measured_of, { measured: project.measured, total: project.total })}
        </span>
      </header>

      <GridStackBar segments={stackShares(project)} ariaLabel={counts} />
      {/* muted-ok: structural counters under the bar they label */}
      <p className="typo-caption text-muted-foreground">{counts}</p>

      <section className="space-y-1">
        {/* muted-ok: structural block label, not body copy */}
        <h4 className="typo-label text-muted-foreground">{o.grid_coverage_title}</h4>
        <GridCoverageSpark values={coverage} ghost={sparkGhost} />
      </section>

      <div className="flex flex-wrap gap-1.5">
        {shown.map((g) => (
          <button
            key={g.key}
            type="button"
            className="typo-caption rounded-pill px-2 py-0.5 text-foreground hover:opacity-80 focus-ring"
            style={
              g.band === 'unmeasured'
                ? { background: HATCH_BG }
                : { background: bandFill(BAND_COLOR[g.band], g.coverage) }
            }
            aria-label={tx(o.cell_aria, {
              group: g.label,
              band: o.band_labels[g.band],
              measured: g.measured,
              total: g.total,
            })}
            onClick={() => onFocus({ projectId: project.projectId, groupId: g.groupId ?? UNGROUPED_KEY })}
          >
            {g.label}
          </button>
        ))}
        {rest > 0 && (
          <button
            type="button"
            // muted-ok: overflow affordance ("+N more"), structural chrome
            className="typo-caption rounded-pill px-2 py-0.5 text-muted-foreground bg-secondary/40 hover:opacity-80 focus-ring"
            aria-label={tx(o.layer_more_title, { count: rest })}
            onClick={openProject}
          >
            {tx(o.layer_more_title, { count: rest })}
          </button>
        )}
      </div>
    </div>
  );
}

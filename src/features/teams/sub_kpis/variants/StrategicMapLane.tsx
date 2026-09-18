// One project lane of the Strategic map (WP1): the project name, its measured
// denominator, then one cell per context group in worst-first order. The lane
// is a flex row inside the map's single horizontal scroller, so every lane
// scrolls as one sheet and columns stay comparable.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { KpiBand, KpiGroupRollup, KpiProjectRollup } from '../kpiOverviewModel';
import { BAND_COLOR } from '../kpiOverviewModel';
import { bandFill, DIMMED_OPACITY, HATCH_BG } from '../kpiChartTheme';
import { BAND_GLYPH, focusGroupId, matchesHighlight } from './StrategicMap.model';

export function StrategicMapLane({
  lane,
  active,
  onOpenProject,
  onOpenGroup,
}: {
  lane: KpiProjectRollup;
  active: KpiBand | null;
  onOpenProject: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  return (
    <div className="flex items-center gap-1.5 min-w-max" data-testid={`kpi-map-lane-${lane.projectId}`}>
      <button
        type="button"
        onClick={onOpenProject}
        aria-label={tx(o.lane_open, { project: lane.label })}
        className="w-[200px] shrink-0 truncate text-left typo-title rounded-interactive px-1.5 py-1 hover:bg-secondary/40 transition-colors focus-ring"
      >
        {lane.label}
      </button>
      {/* muted-ok: the lane's measured denominator is a structural micro-label beside the name, not prose */}
      <span className="w-16 shrink-0 text-right typo-caption text-muted-foreground tabular-nums">
        {tx(o.measured_of, { measured: lane.measured, total: lane.total })}
      </span>
      {lane.groupsUnknown && (
        // muted-ok: a lane annotation about a failed read, deliberately quieter than the lanes themselves
        <span className="shrink-0 typo-caption text-muted-foreground">{o.groups_unknown}</span>
      )}
      <div className="flex items-center gap-1">
        {lane.groups.map((g) => (
          <MapCell
            key={g.key}
            group={g}
            dimmed={!matchesHighlight(g.band, active)}
            onClick={() => onOpenGroup(focusGroupId(g.groupId))}
          />
        ))}
      </div>
    </div>
  );
}

function MapCell({
  group,
  dimmed,
  onClick,
}: {
  group: KpiGroupRollup;
  dimmed: boolean;
  onClick: () => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const color = BAND_COLOR[group.band];
  const unmeasured = group.band === 'unmeasured';
  const label = tx(o.cell_aria, {
    group: group.label,
    band: o.band_labels[group.band],
    measured: group.measured,
    total: group.total,
  });
  return (
    <Tooltip content={`${label} — ${o.band_hints[group.band]}`} delay={250}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        data-testid={`kpi-map-cell-${group.key}`}
        className="relative w-[132px] h-10 shrink-0 overflow-hidden rounded-interactive px-2 py-1 text-left transition-opacity focus-ring"
        style={{
          opacity: dimmed ? DIMMED_OPACITY : 1,
          backgroundImage: unmeasured ? HATCH_BG : undefined,
          background: unmeasured ? undefined : bandFill(color, group.coverage),
          border: `1px ${unmeasured ? 'dashed' : 'solid'} color-mix(in srgb, ${color} 55%, transparent)`,
        }}
      >
        {group.color && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: group.color }}
          />
        )}
        <span className="block truncate typo-label text-foreground">{group.label}</span>
        {/* muted-ok: the cell's n/N denominator + band glyph is chrome under the group name */}
        <span className="block typo-code text-muted-foreground tabular-nums">
          {`${group.measured}/${group.total} ${BAND_GLYPH[group.band]}`}
        </span>
      </button>
    </Tooltip>
  );
}

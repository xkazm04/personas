// Shared KPI-detail building blocks, relocated from the retired KPIDetailDrawer
// so KpiDetailModal can own them without a dead drawer module hanging around:
//   · KpiStoryChart   — the time-series story (target line, today marker, goal
//                       event markers) rendered as a compact inline SVG;
//   · KpiSourceSection — the KPI's live data-source state (active / degraded /
//                       connect invitation).
import { useMemo } from 'react';
import { Cable } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiBinding } from '@/lib/bindings/DevKpiBinding';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ComposedByBadge } from './KPIConnectWizard';

// =============================================================================
// Data source — the KPI's active binding (or the invitation to create one)
// =============================================================================

export function KpiSourceSection({
  kpi,
  bindings,
  onConnect,
}: {
  kpi: DevKpi;
  bindings: DevKpiBinding[];
  onConnect: () => void;
}) {
  const { t, tx } = useTranslation();
  const active = bindings.find((b) => b.status === 'active') ?? null;
  const degraded = !active ? bindings.find((b) => b.status === 'degraded') ?? null : null;
  const connectable =
    kpi.metric_type != null ||
    kpi.needed_connector != null ||
    kpi.measure_kind === 'connector' ||
    kpi.measure_kind === 'manual';

  if (!active && !degraded && !connectable) return null;

  return (
    <div data-testid="kpi-source-section">
      <h3 className="typo-overline text-foreground mb-1.5">{t.kpis.source_section_title}</h3>
      {degraded && (
        <div className="rounded-card border border-status-error/25 bg-status-error/10 p-3 mb-2 space-y-2">
          <p className="typo-body text-foreground">
            {tx(t.kpis.source_degraded_banner, { service: degraded.service_type })}
          </p>
          <Button size="sm" variant="secondary" icon={<Cable className="w-3.5 h-3.5" />} onClick={onConnect}>
            {t.kpis.source_reconnect}
          </Button>
        </div>
      )}
      {active ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="typo-body text-foreground font-medium">{active.service_type}</span>
          <ComposedByBadge composedBy={active.composed_by} />
          {active.verified_at && (
            <span className="typo-caption text-foreground opacity-80">
              {t.kpis.source_verified} <RelativeTime timestamp={active.verified_at} />
            </span>
          )}
          <button
            type="button"
            onClick={onConnect}
            className="typo-caption text-primary rounded-card px-1.5 py-1 hover:bg-secondary/40 transition-colors focus-ring"
            data-testid="kpi-change-source"
          >
            {t.kpis.source_change}
          </button>
        </div>
      ) : (
        !degraded && (
          <div className="flex items-center gap-2 flex-wrap">
            {kpi.measure_kind === 'manual' && (
              <p className="typo-caption text-foreground opacity-80">{t.kpis.source_none_hint}</p>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Cable className="w-3.5 h-3.5" />}
              onClick={onConnect}
              data-testid="kpi-connect-source"
            >
              {t.kpis.source_connect}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

// =============================================================================
// The story chart — time series + target line + today marker + goal markers
// =============================================================================

const W = 360;
const H = 96;
const PAD = 8;

function ts(s: string): number {
  return new Date(s.replace(' ', 'T')).getTime();
}

export function KpiStoryChart({
  kpi,
  measurements,
  simMeasurements = [],
  linkedGoals,
}: {
  kpi: DevKpi;
  measurements: DevKpiMeasurement[];
  /** P3 convergence overlay — simulated (local/test) points rendered as a
   *  dashed line + hollow dots over the solid production story. Empty = the
   *  chart behaves exactly as before. */
  simMeasurements?: DevKpiMeasurement[];
  linkedGoals: DevGoal[];
}) {
  const { t, tx } = useTranslation();

  const model = useMemo(() => {
    const points = [...measurements]
      .map((m) => ({ t: ts(m.measured_at), v: m.value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    const simPoints = [...simMeasurements]
      .map((m) => ({ t: ts(m.measured_at), v: m.value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return null;

    const goalEvents = linkedGoals
      .map((g) => ({
        t: ts(g.completed_at ?? g.created_at),
        done: g.completed_at != null,
        title: g.title,
      }))
      .filter((e) => Number.isFinite(e.t));

    const now = Date.now();
    const tMin = Math.min(first.t, ...goalEvents.map((e) => e.t), ...simPoints.map((p) => p.t));
    const tMax = Math.max(now, last.t, ...simPoints.map((p) => p.t));
    const tSpan = Math.max(tMax - tMin, 1);

    const values = points.map((p) => p.v);
    const vCandidates = [...values, ...simPoints.map((p) => p.v)];
    if (kpi.target_value != null) vCandidates.push(kpi.target_value);
    if (kpi.baseline_value != null) vCandidates.push(kpi.baseline_value);
    const vMin = Math.min(...vCandidates);
    const vMax = Math.max(...vCandidates);
    const vSpan = vMax - vMin || 1;

    const x = (time: number) => PAD + ((time - tMin) / tSpan) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - vMin) / vSpan) * (H - 2 * PAD);

    return {
      line: points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '),
      lastPoint: { x: x(last.t), y: y(last.v) },
      simLine: simPoints.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '),
      simDots: simPoints.map((p) => ({ x: x(p.t), y: y(p.v) })),
      targetY: kpi.target_value != null ? y(kpi.target_value) : null,
      todayX: x(now),
      goalMarks: goalEvents.map((e) => ({ x: x(e.t), done: e.done, title: e.title })),
    };
  }, [measurements, simMeasurements, linkedGoals, kpi.target_value, kpi.baseline_value]);

  if (!model) {
    return <p className="typo-caption text-foreground opacity-80">{t.kpis.chart_no_data}</p>;
  }

  return (
    <div data-testid="kpi-story-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.kpis.chart_aria}>
        {/* target line */}
        {model.targetY != null && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={model.targetY}
            y2={model.targetY}
            stroke="var(--status-success)"
            strokeDasharray="4 3"
            strokeWidth="1"
            opacity="0.7"
          />
        )}
        {/* today marker */}
        <line
          x1={model.todayX}
          x2={model.todayX}
          y1={PAD}
          y2={H - PAD}
          stroke="var(--primary)"
          strokeWidth="1"
          opacity="0.35"
        />
        {/* goal-event markers */}
        {model.goalMarks.map((g, i) => (
          <line
            key={i}
            x1={g.x}
            x2={g.x}
            y1={PAD}
            y2={H - PAD}
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeDasharray={g.done ? undefined : '3 3'}
            opacity="0.8"
          />
        ))}
        {/* the simulated overlay — dashed + hollow dots, visually subordinate
            to the solid production truth line */}
        {model.simDots.length > 1 && (
          <polyline points={model.simLine} fill="none" stroke="#8B5CF6" strokeWidth="1.25" strokeDasharray="5 4" opacity="0.85" />
        )}
        {model.simDots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.2" fill="var(--background)" stroke="#8B5CF6" strokeWidth="1.25" />
        ))}
        {/* the measurement line */}
        <polyline points={model.line} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
        <circle cx={model.lastPoint.x} cy={model.lastPoint.y} r="2.5" fill="var(--primary)" />
      </svg>
      {model.goalMarks.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {model.goalMarks.map((g, i) => (
            <Tooltip key={i} content={g.title}>
              <span className="typo-caption text-foreground opacity-80 truncate max-w-[10rem]">
                ▎{g.done ? t.kpis.goal_marker_done : t.kpis.goal_marker_open}: {g.title}
              </span>
            </Tooltip>
          ))}
        </div>
      )}
      <p className="typo-caption text-foreground opacity-70 mt-0.5">
        {model.targetY != null ? tx(t.kpis.chart_legend, { target: kpi.target_value ?? 0, unit: kpi.unit || '' }) : ''}
      </p>
    </div>
  );
}

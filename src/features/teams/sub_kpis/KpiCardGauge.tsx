// KPI card — GAUGE variant ("instrument" metaphor): the KPI is a cockpit
// dial. A 240° radial arc spans baseline→target; the sweep is the current
// value, drawn once on mount (pathLength entry animation, no looping motion).
// Direction-aware: for down-is-better KPIs the dial fills as the value drops
// toward the target. The number sits IN the instrument (typo-data-lg), the
// pace state colors the sweep via the shared TRACK_COLOR ramp, and the
// distance-to-target reads under the dial. Differs from baseline by making
// the measurement itself the hero — text becomes the caption of the dial.
import { motion } from 'framer-motion';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { paceDescriptor } from './kpiMath';
import { categoryMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';
import {
  KpiCardFooter,
  paceSentence,
  TRACK_COLOR,
  TRACK_TINT,
  type KpiCardProps,
} from './KpiCardBaseline';

const R = 44;
const CX = 56;
const CY = 56;
const START_DEG = 210; // 240° sweep: 210° → -30° (clockwise through the top)
const SWEEP_DEG = 240;

function polar(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + R * Math.cos(rad), CY - R * Math.sin(rad)];
}

/** Arc path for a fraction (0..1) of the 240° sweep, clockwise. */
function arcPath(frac: number): string {
  const clamped = Math.max(0.001, Math.min(1, frac));
  const end = START_DEG - clamped * SWEEP_DEG;
  const [x0, y0] = polar(START_DEG);
  const [x1, y1] = polar(end);
  const large = clamped * SWEEP_DEG > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Fraction of baseline→target covered by the current value, direction-aware. */
function sweepFraction(kpi: DevKpi): number | null {
  const { current_value: cur, target_value: target, baseline_value: baseline } = kpi;
  if (cur == null || target == null) return null;
  if (baseline == null || target === baseline) {
    // No baseline: show simple ratio toward target (direction-aware).
    if (kpi.direction === 'down') return target > 0 ? Math.min(1, target / Math.max(cur, 1e-9)) : 1;
    return target > 0 ? Math.min(1, cur / target) : 1;
  }
  return Math.max(0, Math.min(1, (cur - baseline) / (target - baseline)));
}

export function KpiCardGauge({ kpi, onOpen, onConnect }: KpiCardProps) {
  const { t, tx } = useTranslation();
  const d = paceDescriptor(kpi);
  const cat = categoryMeta(kpi.category);
  const CatIcon = cat.icon;
  const frac = sweepFraction(kpi);
  const color = TRACK_COLOR[d.track];
  const remaining =
    kpi.current_value != null && kpi.target_value != null
      ? Math.abs(kpi.target_value - kpi.current_value)
      : null;
  const remainingLabel =
    remaining != null && d.track !== 'met'
      ? tx(t.kpis.gauge_to_go, { delta: Math.round(remaining * 100) / 100, unit: kpi.unit || '' })
      : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(kpi.id)}
      data-testid={`kpi-card-${kpi.id}`}
      className={`text-left rounded-card border bg-secondary/20 hover:bg-secondary/40 transition-colors p-4 ${TRACK_TINT[d.track]} ${kpi.status === 'paused' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="typo-heading text-foreground">{kpi.name}</span>
        <Tooltip content={cat.label(t)}>
          <CatIcon className="w-4 h-4 text-foreground flex-shrink-0" aria-label={cat.label(t)} />
        </Tooltip>
      </div>

      <div className="flex items-center gap-3">
        {/* The instrument */}
        <svg viewBox="0 0 112 112" className="w-24 h-24 flex-shrink-0" aria-hidden>
          {/* dial track */}
          <path d={arcPath(1)} fill="none" stroke="var(--secondary)" strokeWidth="7" strokeLinecap="round" />
          {/* value sweep — draws once on mount */}
          {frac != null && (
            <motion.path
              d={arcPath(frac)}
              fill="none"
              stroke={color}
              strokeWidth="7"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
          )}
          {/* target tick at the end of the dial */}
          <circle cx={polar(START_DEG - SWEEP_DEG)[0]} cy={polar(START_DEG - SWEEP_DEG)[1]} r="2.5" fill="var(--success)" />
          {/* the number lives in the instrument */}
          <foreignObject x="14" y="32" width="84" height="44">
            <div className="flex flex-col items-center justify-center h-full">
              <span className="typo-data-lg text-foreground tabular-nums leading-none">
                {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
              </span>
              <span className="typo-caption text-foreground opacity-80 leading-none mt-0.5">
                {kpi.unit || ' '}
              </span>
            </div>
          </foreignObject>
        </svg>

        <div className="min-w-0 flex-1 space-y-1">
          {kpi.target_value != null && (
            <p className="typo-caption text-foreground tabular-nums">
              {tx(t.kpis.gauge_target_line, { target: kpi.target_value, unit: kpi.unit || '' })}
              {kpi.direction === 'down' ? ` ${t.kpis.gauge_lower_better}` : ''}
            </p>
          )}
          {remainingLabel && (
            <p className="typo-body text-foreground tabular-nums" style={{ color }}>
              {remainingLabel}
            </p>
          )}
          <p className="typo-caption text-foreground">{paceSentence(kpi, t, tx)}</p>
        </div>
      </div>

      <p className="typo-caption text-foreground opacity-80 mt-1">
        {describeMeasurement(kpi, t, tx)}
      </p>
      <div className="mt-1">
        <KpiCardFooter kpi={kpi} onConnect={onConnect} />
      </div>
    </button>
  );
}

// KPI card — BULLET variant ("benchmark strip" metaphor): the KPI is an
// engineering benchmark, read like a ruler. A horizontal bullet graph (Few
// style) carries the whole story in one dense strip: the qualitative band is
// the baseline→target span, the measure bar is the current value, labeled
// ticks mark BASELINE and TARGET with their real numbers, and a pace-colored
// measure bar encodes state. Direction-aware: down-is-better strips run
// target-left. Differs from baseline + gauge by maximizing data-per-pixel —
// every mark on the strip is a real number, no abstract progress.
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

/** Strip domain: pad the baseline→target span 15% each side so the measure
 *  bar and overshoots stay visible. Returns x∈[0,100] for a value. */
function stripScale(kpi: DevKpi): ((v: number) => number) | null {
  const { target_value: target, baseline_value: baseline, current_value: cur } = kpi;
  if (target == null) return null;
  const lo0 = Math.min(baseline ?? target, target, cur ?? target);
  const hi0 = Math.max(baseline ?? target, target, cur ?? target);
  const pad = Math.max((hi0 - lo0) * 0.15, Math.abs(target) * 0.05, 0.5);
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  return (v: number) => ((v - lo) / (hi - lo)) * 100;
}

export function KpiCardBullet({ kpi, onOpen, onConnect }: KpiCardProps) {
  const { t, tx } = useTranslation();
  const d = paceDescriptor(kpi);
  const cat = categoryMeta(kpi.category);
  const CatIcon = cat.icon;
  const color = TRACK_COLOR[d.track];
  const scale = stripScale(kpi);

  const cur = kpi.current_value;
  const target = kpi.target_value;
  const baseline = kpi.baseline_value;

  return (
    <button
      type="button"
      onClick={() => onOpen(kpi.id)}
      data-testid={`kpi-card-${kpi.id}`}
      className={`text-left rounded-card border bg-secondary/20 hover:bg-secondary/40 transition-colors p-4 space-y-2 ${TRACK_TINT[d.track]} ${kpi.status === 'paused' ? 'opacity-60' : ''}`}
    >
      {/* Header row: name + current value right-aligned like a ledger line. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="typo-heading text-foreground min-w-0 truncate">{kpi.name}</span>
        <span className="typo-data-lg text-foreground tabular-nums flex-shrink-0">
          {cur != null ? <Numeric value={cur} /> : '—'}
          <span className="typo-caption text-foreground opacity-80 ml-1">{kpi.unit}</span>
        </span>
      </div>

      {/* The benchmark strip. */}
      {scale && (
        <div className="relative h-9 mt-1" aria-hidden>
          {/* qualitative band: baseline → target span */}
          {baseline != null && target != null && (
            <div
              className="absolute top-3 h-2 rounded-sm bg-secondary/70"
              style={{
                left: `${Math.min(scale(baseline), scale(target))}%`,
                width: `${Math.abs(scale(target) - scale(baseline))}%`,
              }}
            />
          )}
          {/* measure bar: zero-width → current, pace-colored, draws on mount */}
          {cur != null && baseline != null && (
            <motion.div
              className="absolute top-[15px] h-1 rounded-sm"
              style={{
                background: color,
                left: `${Math.min(scale(baseline), scale(cur))}%`,
              }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.abs(scale(cur) - scale(baseline))}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          )}
          {/* current marker */}
          {cur != null && (
            <div
              className="absolute top-2 w-[3px] h-4 rounded-sm"
              style={{ left: `calc(${scale(cur)}% - 1px)`, background: color }}
            />
          )}
          {/* target tick + label */}
          {target != null && (
            <>
              <div
                className="absolute top-1.5 w-px h-5 bg-success"
                style={{ left: `${scale(target)}%` }}
              />
              <span
                className="absolute top-7 typo-caption text-foreground tabular-nums -translate-x-1/2"
                style={{ left: `${scale(target)}%` }}
              >
                {t.kpis.bullet_target_tick} <Numeric value={target} />
              </span>
            </>
          )}
          {/* baseline tick + label */}
          {baseline != null && baseline !== target && (
            <>
              <div
                className="absolute top-2 w-px h-4 bg-foreground/40"
                style={{ left: `${scale(baseline)}%` }}
              />
              <span
                className="absolute -top-0.5 typo-caption text-foreground opacity-70 tabular-nums -translate-x-1/2"
                style={{ left: `${scale(baseline)}%` }}
              >
                {t.kpis.bullet_baseline_tick} <Numeric value={baseline} />
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="typo-caption text-foreground">{paceSentence(kpi, t, tx)}</p>
        <Tooltip content={cat.label(t)}>
          <CatIcon className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-label={cat.label(t)} />
        </Tooltip>
      </div>
      <p className="typo-caption text-foreground opacity-80">{describeMeasurement(kpi, t, tx)}</p>
      <KpiCardFooter kpi={kpi} onConnect={onConnect} />
    </button>
  );
}

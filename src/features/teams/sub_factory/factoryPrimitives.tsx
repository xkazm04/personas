// Shared leaf widgets for the Factory KPI prototypes. Kept deliberately small
// and styling-neutral so each directional variant can compose them into its own
// metaphor. These are the "extractable" pieces a winning variant would graft
// back into the real KPI surface.
import { Star, ChevronLeft } from 'lucide-react';
import { STATUS_COLOR, STATUS_LABEL, TRAFFIC_COLOR, trafficCounts, progressPct, fmtUnit, type Traffic, type KpiStatus, type MockKpi, kpiStatus } from './factoryMock';

/** Compact measurement sparkline (oldest → newest). */
export function Sparkline({
  series,
  color,
  width = 64,
  height = 18,
}: {
  series: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return <span className="inline-block text-muted-foreground/50 typo-caption">—</span>;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true" className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function StatusDot({ status, size = 8 }: { status: KpiStatus; size?: number }) {
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{ width: size, height: size, background: STATUS_COLOR[status] }}
    />
  );
}

/** 0–100 health bar — traffic-light ramp (green / yellow / red). */
export function HealthBar({ value, className = '' }: { value: number; className?: string }) {
  const color = value >= 70 ? TRAFFIC_COLOR.green : value >= 40 ? TRAFFIC_COLOR.yellow : TRAFFIC_COLOR.red;
  return (
    <div className={`h-1.5 rounded-full bg-secondary/40 overflow-hidden ${className}`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, value)}%`, background: color }} />
    </div>
  );
}

/** 0–5 manual rating. Interactive when `onChange` is supplied. */
export function RatingStars({
  value,
  onChange,
  size = 13,
}: {
  value: number | null;
  onChange?: (v: number) => void;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={!onChange}
            onClick={() => onChange?.(n)}
            aria-label={`Rate ${n}`}
            className={onChange ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}
          >
            <Star
              style={{ width: size, height: size }}
              className={filled ? 'text-amber-400' : 'text-muted-foreground/30'}
              fill={filled ? 'currentColor' : 'none'}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </span>
  );
}

/**
 * Calibration track — the heart of "steering by KPI". Renders the baseline →
 * target span as a rail with warn/crit zones shaded, the current value as a
 * marker, and the target as a flag. Used by variants that want a linear
 * (non-radial) calibration affordance.
 */
export function CalibrationTrack({ kpi, height = 30 }: { kpi: MockKpi; height?: number }) {
  const status = kpiStatus(kpi);
  // Map values onto [0,1] across the visible domain (a bit of padding beyond
  // baseline/target so the marker never clips at the edges).
  const lo = Math.min(kpi.baseline, kpi.target, kpi.critAt, kpi.current ?? kpi.baseline);
  const hi = Math.max(kpi.baseline, kpi.target, kpi.critAt, kpi.current ?? kpi.target);
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;

  // For direction 'up', danger sits on the low side (≤ crit) and target on the
  // high side; mirror for 'down'.
  const up = kpi.direction === 'up';
  const critFrom = up ? min : kpi.critAt;
  const critTo = up ? kpi.critAt : max;
  const warnFrom = up ? kpi.critAt : kpi.warnAt;
  const warnTo = up ? kpi.warnAt : kpi.critAt;

  return (
    <div className="w-full">
      <div className="relative rounded-full bg-secondary/30 overflow-hidden" style={{ height }}>
        {/* crit zone */}
        <div
          className="absolute top-0 bottom-0"
          style={{ left: pos(Math.min(critFrom, critTo)), width: `calc(${pos(Math.max(critFrom, critTo))} - ${pos(Math.min(critFrom, critTo))})`, background: `color-mix(in srgb, ${TRAFFIC_COLOR.red} 24%, transparent)` }}
        />
        {/* warn zone */}
        <div
          className="absolute top-0 bottom-0"
          style={{ left: pos(Math.min(warnFrom, warnTo)), width: `calc(${pos(Math.max(warnFrom, warnTo))} - ${pos(Math.min(warnFrom, warnTo))})`, background: `color-mix(in srgb, ${TRAFFIC_COLOR.yellow} 24%, transparent)` }}
        />
        {/* target flag */}
        <div className="absolute top-0 bottom-0 w-0.5" style={{ left: pos(kpi.target), background: TRAFFIC_COLOR.green }} />
        {/* current marker */}
        {kpi.current != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ring-2 ring-background"
            style={{ left: pos(kpi.current), width: height * 0.55, height: height * 0.55, background: STATUS_COLOR[status] }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1 typo-caption text-muted-foreground tabular-nums">
        <span>base {fmtUnit(kpi.baseline, kpi.unit)}</span>
        <span style={{ color: TRAFFIC_COLOR.green }}>target {fmtUnit(kpi.target, kpi.unit)}</span>
      </div>
    </div>
  );
}

/** Traffic-light status chip with its label — the at-a-glance verdict. */
export function StatusPill({ status, className = '' }: { status: KpiStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 typo-caption rounded-full px-2 py-0.5 font-medium ${className}`}
      style={{ color: STATUS_COLOR[status], background: `color-mix(in srgb, ${STATUS_COLOR[status]} 16%, transparent)` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A labelled threshold slider — the clear, visual way to calibrate a band. */
export function ThresholdSlider({
  label,
  color,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  color: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const step = Math.max(0.01, Math.round(((max - min) / 100) * 100) / 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-1.5 typo-caption">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="typo-data tabular-nums" style={{ color }}>{fmtUnit(value, unit)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 cursor-pointer"
        style={{ accentColor: color }}
        aria-label={label}
      />
    </div>
  );
}

/** Rate (0–5) + capture pros & cons — the extended assessment / calibration journal. */
export function AssessmentEditor({
  rating,
  pros,
  cons,
  onRate,
  onPros,
  onCons,
  size = 24,
}: {
  rating: number | null;
  pros: string | null | undefined;
  cons: string | null | undefined;
  onRate: (v: number) => void;
  onPros: (v: string) => void;
  onCons: (v: string) => void;
  size?: number;
}) {
  const ta = 'w-full px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-interactive text-foreground placeholder:text-foreground/40 focus-ring resize-none';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <RatingStars value={rating} onChange={onRate} size={size} />
        <span className="typo-caption">{rating != null ? `${rating}/5 confidence` : 'not yet rated'}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="typo-caption flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TRAFFIC_COLOR.green }} /> Pros — what's working
          </span>
          <textarea value={pros ?? ''} onChange={(e) => onPros(e.target.value)} rows={3} placeholder="Strengths of this signal…" className={ta} />
        </label>
        <label className="block">
          <span className="typo-caption flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ background: TRAFFIC_COLOR.red }} /> Cons — what's off
          </span>
          <textarea value={cons ?? ''} onChange={(e) => onCons(e.target.value)} rows={3} placeholder="Caveats, gaps, risks…" className={ta} />
        </label>
      </div>
    </div>
  );
}

/** Red→yellow→green→gray count strip — the traffic-light summary of a node. */
export function TrafficTally({ kpis, size = 7 }: { kpis: MockKpi[]; size?: number }) {
  const c = trafficCounts(kpis);
  const order: Array<[Traffic, number]> = [['red', c.red], ['yellow', c.yellow], ['green', c.green], ['gray', c.gray]];
  return (
    <span className="inline-flex items-center gap-2">
      {order.map(([tk, n]) =>
        n > 0 ? (
          <span key={tk} className="inline-flex items-center gap-1">
            <span className="rounded-full flex-shrink-0" style={{ width: size, height: size, background: TRAFFIC_COLOR[tk] }} />
            <span className="typo-caption tabular-nums text-foreground">{n}</span>
          </span>
        ) : null,
      )}
    </span>
  );
}

/** The newly-introduced "bar rating": a KPI's baseline→target progress as a
 *  compact bar. Three looks so variants can explore the L3 KPI table:
 *  `bar` (progress fill), `segments` (stepped signal bars), `meter` (fill +
 *  target tick). Always traffic-coloured by status. */
export function KpiBarRating({ kpi, variant = 'bar', width = 120 }: { kpi: MockKpi; variant?: 'bar' | 'segments' | 'meter'; width?: number }) {
  const color = STATUS_COLOR[kpiStatus(kpi)];
  const pct = progressPct(kpi);
  if (variant === 'segments') {
    const segs = 6;
    const filled = pct == null ? 0 : Math.max(0, Math.round((pct / 100) * segs));
    return (
      <span className="inline-flex gap-[3px] items-center" style={{ width }}>
        {Array.from({ length: segs }).map((_, i) => (
          <span key={i} className="flex-1 rounded-sm" style={{ height: 12, background: i < filled ? color : 'color-mix(in srgb, var(--foreground) 12%, transparent)' }} />
        ))}
      </span>
    );
  }
  if (variant === 'meter') {
    return (
      <div style={{ width }} className="relative rounded-full bg-secondary/40">
        <div className="h-2.5 rounded-full" style={{ width: `${Math.max(2, pct ?? 0)}%`, background: color }} />
        <div className="absolute top-1/2 w-0.5 h-3.5 rounded" style={{ left: '100%', transform: 'translate(-1px,-50%)', background: TRAFFIC_COLOR.green }} />
      </div>
    );
  }
  return (
    <div style={{ width }} className="h-2 rounded-full bg-secondary/40 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct ?? 0)}%`, background: color }} />
    </div>
  );
}

/** Shared drill-down breadcrumb with a Back affordance. The clickable nested
 *  layers give each level a full screen (the agreed navigation model). */
export function Breadcrumb({ trail }: { trail: Array<{ label: string; onClick?: () => void }> }) {
  // Back goes up exactly ONE level (the immediate parent = second-to-last
  // crumb), never all the way to the start. Crumbs stay individually clickable.
  const parent = trail.length >= 2 ? trail[trail.length - 2] : undefined;
  return (
    <div className="flex items-center gap-1.5 typo-body mb-3 flex-wrap">
      {parent?.onClick && (
        <button type="button" onClick={parent.onClick} className="flex items-center gap-1 text-foreground hover:text-primary font-medium mr-1.5">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      )}
      {trail.map((t, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground/40">/</span>}
          {t.onClick ? (
            <button type="button" onClick={t.onClick} className="text-muted-foreground hover:text-foreground">{t.label}</button>
          ) : (
            <span className="text-foreground font-semibold">{t.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Factory leaf widgets the composition kit does not have: a sparkline, the
// calibration track (a small chart), the threshold slider and the assessment
// editor. Every colour is a kit tone (toneColor), so a series reads in the same
// hue as the Mark beside it.
//
// Gate 5 removed the widgets that duplicated a kit part (StatusDot -> Dot,
// StatusPill -> Mark, TrafficTally -> a Dot legend, KpiBarRating -> UnitStrip,
// HealthBar was unused, Breadcrumb -> FactoryHead). They also painted with
// `var(--success)` and `var(--destructive)`, which no theme defines, so every
// healthy and every failing mark, bar and sparkline they drew was invisible.
import { Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Dot, toneColor } from '@/features/shared/components/kit';
import { fmtUnit, kpiStatus, type MockKpi } from './factoryModel';
import { KPI_STATUS_MARK } from './factoryTone';

/** Compact measurement sparkline (oldest to newest). Accepts either `series`
 *  (Factory KPI callers) or `values` (passport trend callers). `color`
 *  defaults to `currentColor` so it can inherit from a wrapping text colour. */
export function Sparkline({
  series,
  values,
  color,
  width = 64,
  height = 18,
}: {
  series?: number[];
  values?: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const data = series ?? values ?? [];
  if (data.length < 2) return <span className="inline-block k-quiet typo-caption">-</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true" className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color ?? 'currentColor'} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** 0-5 manual rating. Interactive when `onChange` is supplied. */
export function RatingStars({ value, onChange, size = 13 }: { value: number | null; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value != null && n <= value;
        return (
          <Button
            key={n}
            variant="ghost"
            size="icon-sm"
            disabled={!onChange}
            onClick={() => onChange?.(n)}
            aria-label={`Rate ${n}`}
          >
            <Star
              style={{ width: size, height: size }}
              className={filled ? 'text-primary' : 'k-quiet'}
              fill={filled ? 'currentColor' : 'none'}
              strokeWidth={1.5}
            />
          </Button>
        );
      })}
    </span>
  );
}

/**
 * Calibration track: the baseline-to-target span as a rail with the off-track
 * and at-risk zones shaded, the current value as a marker and the target as a
 * flag. Zones and marks are status tones.
 */
export function CalibrationTrack({ kpi, height = 30 }: { kpi: MockKpi; height?: number }) {
  const mark = KPI_STATUS_MARK[kpiStatus(kpi)];
  const lo = Math.min(kpi.baseline, kpi.target, kpi.critAt, kpi.current ?? kpi.baseline);
  const hi = Math.max(kpi.baseline, kpi.target, kpi.critAt, kpi.current ?? kpi.target);
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const zone = (from: number, to: number, tone: 'error' | 'warning') => (
    <div
      className="absolute top-0 bottom-0"
      style={{ left: pos(Math.min(from, to)), width: `calc(${pos(Math.max(from, to))} - ${pos(Math.min(from, to))})`, background: `color-mix(in srgb, ${toneColor(tone)} 24%, transparent)` }}
    />
  );
  // For direction 'up' danger sits on the low side and the target high; mirrored for 'down'.
  const up = kpi.direction === 'up';
  return (
    <div className="w-full">
      <div className="relative rounded-full overflow-hidden" style={{ height, background: 'var(--band-alt)' }}>
        {zone(up ? min : kpi.critAt, up ? kpi.critAt : max, 'error')}
        {zone(up ? kpi.critAt : kpi.warnAt, up ? kpi.warnAt : kpi.critAt, 'warning')}
        <div className="absolute top-0 bottom-0 w-0.5" style={{ left: pos(kpi.target), background: toneColor('success') }} />
        {kpi.current != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ring-2 ring-background"
            style={{ left: pos(kpi.current), width: height * 0.55, height: height * 0.55, background: toneColor(mark.tone) }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1 typo-caption tabular-nums">
        <span>base {fmtUnit(kpi.baseline, kpi.unit)}</span>
        <span>target {fmtUnit(kpi.target, kpi.unit)}</span>
      </div>
    </div>
  );
}

/** A labelled threshold slider: the visual way to calibrate a band. */
export function ThresholdSlider({ label, tone, value, min, max, unit, onChange }: {
  label: string;
  tone: 'warning' | 'error';
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const step = Math.max(0.01, Math.round(((max - min) / 100) * 100) / 100);
  return (
    <div className="k-in">
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-2 typo-body">
          <Dot tone={tone} glyph="solid" />
          {label}
        </span>
        <span className="typo-data k-regular">{fmtUnit(value, unit)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 cursor-pointer"
        style={{ accentColor: toneColor(tone) }}
        aria-label={label}
      />
    </div>
  );
}

/** Rate (0-5) and capture pros and cons: the calibration journal. */
export function AssessmentEditor({ rating, pros, cons, onRate, onPros, onCons, labels, size = 22 }: {
  rating: number | null;
  pros: string | null | undefined;
  cons: string | null | undefined;
  onRate: (v: number) => void;
  onPros: (v: string) => void;
  onCons: (v: string) => void;
  labels: { pros: string; cons: string; prosHint: string; consHint: string; rated: (n: number) => string; unrated: string };
  size?: number;
}) {
  const ta = 'w-full px-2.5 py-1.5 typo-body bg-secondary/40 border border-primary/10 rounded-interactive text-foreground placeholder:text-foreground/40 focus-ring resize-none';
  return (
    <div className="k-in space-y-3">
      <div className="flex items-center gap-3">
        <RatingStars value={rating} onChange={onRate} size={size} />
        <span className="typo-caption">{rating != null ? labels.rated(rating) : labels.unrated}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="typo-label k-quiet flex items-center gap-2 mb-1"><Dot tone="success" glyph="soft" />{labels.pros}</span>
          <textarea value={pros ?? ''} onChange={(e) => onPros(e.target.value)} rows={3} placeholder={labels.prosHint} className={ta} />
        </label>
        <label className="block">
          <span className="typo-label k-quiet flex items-center gap-2 mb-1"><Dot tone="error" glyph="soft" />{labels.cons}</span>
          <textarea value={cons ?? ''} onChange={(e) => onCons(e.target.value)} rows={3} placeholder={labels.consHint} className={ta} />
        </label>
      </div>
    </div>
  );
}

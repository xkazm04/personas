// A small line of values over time, oldest on the left, feature-local (the
// kit draws no time series this small). Each point carries its own tone, so
// a failed run is an error dot on the line and a run with no value (did not
// run, timed out) is a hollow tick on the floor instead of a fake zero.
// Reference lines (a budget, a threshold) are drawn dashed across the width.
// The drawing is aria-hidden: the caller says what it shows in text.
import type { Tone } from '@/features/shared/components/kit';

export interface SparkPoint {
  value: number | null;
  tone: Tone;
}

const INK: Partial<Record<Tone, string>> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
  neutral: 'text-foreground',
  primary: 'text-primary',
};

interface SparklineProps {
  points: SparkPoint[];
  /** Domain top; defaults to the largest value or reference. */
  max?: number;
  /** Domain floor; defaults to 0. Raise it to zoom a series that lives in a narrow band. */
  min?: number;
  /** Dashed reference lines; a `label` is written at the line's right end. */
  refs?: { value: number; tone: Tone; label?: string }[];
  width?: number;
  height?: number;
  testId?: string;
}

export function Sparkline({ points, max, min = 0, refs = [], width = 132, height = 36, testId }: SparklineProps) {
  // A chart-sized line (a trend panel) draws heavier marks than a row-sized one.
  const big = height >= 60;
  const pad = big ? 8 : 4;
  const top = max ?? Math.max(1, ...points.map((p) => p.value ?? 0), ...refs.map((r) => r.value)) * 1.1;
  const x = (i: number) => (points.length <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (points.length - 1));
  const y = (v: number) => height - pad - ((Math.max(min, Math.min(v, top)) - min) / Math.max(1e-9, top - min)) * (height - pad * 2);
  const known = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);
  const path = known.map((p, j) => `${j ? 'L' : 'M'} ${x(p.i)} ${y(p.value!)}`).join(' ');
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block shrink-0 overflow-visible" data-testid={testId} data-points={points.length}>
      {refs.map((r) => (
        <g key={`${r.tone}-${r.value}`} className={INK[r.tone] ?? 'text-foreground'}>
          <line x1={0} x2={width} y1={y(r.value)} y2={y(r.value)} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" />
          {r.label && <text x={width + 8} y={y(r.value) + 4} fill="currentColor" className="typo-label">{r.label}</text>}
        </g>
      ))}
      {known.length > 1 && <path d={path} fill="none" stroke="currentColor" strokeWidth={big ? 2.5 : 1.5} strokeLinejoin="round" className="text-primary/60" />}
      {points.map((p, i) =>
        p.value == null ? (
          <circle key={i} cx={x(i)} cy={height - pad} r={big ? 4 : 2.5} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-foreground" />
        ) : (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={(i === points.length - 1 ? 1 : 0) + (big ? 4.5 : 2.5)} fill="currentColor" className={INK[p.tone] ?? 'text-foreground'} />
        ),
      )}
    </svg>
  );
}

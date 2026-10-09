/**
 * Tests coverage over the Measures as a line, with its two thresholds from
 * the snapshot's rules drawn faint across the row (green dashed in the
 * success ink, the amber floor in the warning ink; the scale column names
 * them). Each reading is a dot in the band it falls in - healthy, at risk,
 * failing - so the dots read without the line; a Measure with no coverage
 * reading draws a hollow ring on the floor, never a zero. The viewed
 * Measure's dot is larger and ringed.
 *
 * Geometry: the line and its soft area are one stretched SVG (`viewBox`
 * 0..100, `preserveAspectRatio="none"`, strokes that do not scale); the dots
 * and the threshold rules are positioned in percent over it, so nothing is
 * distorted and nothing is measured. Drawn parts only (`aria-hidden`).
 */
import { useId } from 'react';
import { motion } from 'framer-motion';

import { useEntrance } from '../../system/entrance';
import { HIST_ROW } from '../historyGeometry';

export interface CoverageScale {
  lo: number;
  hi: number;
  green: number;
  amber: number;
}

/** A value's height in the row, top = 0%, with a margin so a dot is never cut. */
export function yPct(v: number, s: CoverageScale): number {
  const t = (Math.max(s.lo, Math.min(s.hi, v)) - s.lo) / Math.max(1e-9, s.hi - s.lo);
  return 8 + (1 - t) * 84;
}

const xPct = (i: number, n: number) => ((i + 0.5) / Math.max(1, n)) * 100;

const DOT_INK = { success: 'text-status-success', warning: 'text-status-warning', error: 'text-status-error' } as const;

function band(v: number, s: CoverageScale): keyof typeof DOT_INK {
  return v >= s.green ? 'success' : v >= s.amber ? 'warning' : 'error';
}

/** The known points as runs of consecutive readings (a gap breaks the line). */
function runs(values: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push({ i, v });
  });
  if (cur.length) out.push(cur);
  return out;
}

export function CoverageRow({ values, scale, at }: { values: (number | null)[]; scale: CoverageScale; at: number }) {
  const entering = useEntrance();
  const gradient = useId();
  const n = values.length;
  const segments = runs(values);
  const pt = (p: { i: number; v: number }) => `${xPct(p.i, n)},${yPct(p.v, scale)}`;
  return (
    <div aria-hidden className={`relative ${HIST_ROW.coverage}`} data-history-row="coverage">
      {([['green', 'border-status-success/55'], ['amber', 'border-status-warning/55']] as const).map(([k, ink]) => (
        <span key={k} className={`absolute inset-x-0 border-t border-dashed ${ink}`} style={{ top: `${yPct(scale[k], scale)}%` }} data-threshold={k} />
      ))}
      <motion.div
        className="absolute inset-0"
        initial={entering ? { clipPath: 'inset(0 100% 0 0)' } : false}
        animate={{ clipPath: 'inset(0 0% 0 0)' }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: entering ? 0.15 : 0 }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible text-primary">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {segments.map((s) => (
            <g key={s[0]!.i}>
              {s.length > 1 && (
                <polygon points={`${xPct(s[0]!.i, n)},100 ${s.map(pt).join(' ')} ${xPct(s[s.length - 1]!.i, n)},100`} fill={`url(#${gradient})`} />
              )}
              {s.length > 1 && (
                <polyline points={s.map(pt).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              )}
            </g>
          ))}
        </svg>
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {values.map((v, i) => (v == null ? (
            <circle key={i} cx={`${xPct(i, n)}%`} cy="92%" r={3} fill="none" stroke="currentColor" strokeWidth={1.25} className="text-foreground" data-dot="none" />
          ) : (
            <circle
              key={i}
              cx={`${xPct(i, n)}%`}
              cy={`${yPct(v, scale)}%`}
              r={i === at ? 5.5 : 3.5}
              fill="currentColor"
              stroke={i === at ? 'var(--background)' : 'none'}
              strokeWidth={i === at ? 2 : 0}
              className={DOT_INK[band(v, scale)]}
              data-dot={band(v, scale)}
            />
          )))}
        </svg>
      </motion.div>
    </div>
  );
}

// The header band's two figures. Pure SVG: they take numbers and draw, they
// fetch nothing and hold no state, and every label is a prop so the band owns
// the translation.
import { useId } from 'react';

import type { FeatureMove } from '../featureRules';

/** The move each mark paints with. `never` is HATCHED, never an empty bar:
 *  absence of a council is a fact, and a blank would read as a zero. */
const MOVE_FILL: Record<FeatureMove, string> = {
  waiting: 'var(--status-pending)',
  trouble: 'var(--status-error)',
  working: 'var(--primary)',
  settled: 'var(--status-success)',
  never: 'transparent',
};

export interface StateStripProps {
  /** One entry per feature, ALREADY ordered by whose move it is. */
  moves: FeatureMove[];
  width: number;
  height?: number;
  label: string;
}

/**
 * One mark per feature, in move order: the shape of the whole roster in a band
 * the width of a sentence. At 100 features each mark is ~3 px, which is a
 * texture rather than a row - that is the point.
 */
export function StateStrip({ moves, width, height = 26, label }: StateStripProps) {
  const id = useId();
  const n = moves.length;
  if (n === 0) return null;
  const gap = n > 60 ? 1 : 2;
  const cell = Math.max(2, (width - gap * (n - 1)) / n);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="flex-none"
    >
      <defs>
        <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="color-mix(in srgb, var(--foreground) 34%, transparent)" strokeWidth="1.6" />
        </pattern>
      </defs>
      {moves.map((move, i) => {
        const x = i * (cell + gap);
        const never = move === 'never';
        return (
          <rect
            key={`${move}-${i}`}
            x={x.toFixed(2)}
            y={never ? 5 : 2}
            width={cell.toFixed(2)}
            height={never ? height - 10 : height - 4}
            rx={Math.min(2, cell / 2)}
            fill={never ? `url(#${id}-hatch)` : MOVE_FILL[move]}
            stroke={never ? 'color-mix(in srgb, var(--foreground) 26%, transparent)' : 'none'}
            strokeWidth={never ? 1 : 0}
          />
        );
      })}
    </svg>
  );
}

export interface ClaimBarSlice {
  role: 'core' | 'platform' | 'tests' | 'unclaimed';
  count: number;
}

export interface ClaimBarProps {
  slices: ClaimBarSlice[];
  width: number;
  height?: number;
  label: string;
}

const CLAIM_FILL: Record<ClaimBarSlice['role'], string> = {
  core: 'var(--primary)',
  platform: 'var(--status-info)',
  tests: 'color-mix(in srgb, var(--foreground) 24%, transparent)',
  unclaimed: 'transparent',
};

/**
 * How much of the codebase a feature claims, as ONE stacked bar. The unclaimed
 * share is drawn hollow with a dashed rule rather than filled: it is the
 * page's to-do list, and filling it would read as a fourth kind of progress.
 */
export function ClaimBar({ slices, width, height = 18, label }: ClaimBarProps) {
  const total = slices.reduce((n, s) => n + s.count, 0);
  if (total <= 0) return null;
  let x = 0;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="flex-none"
    >
      {slices.map((slice) => {
        const w = (slice.count / total) * width;
        const at = x;
        x += w;
        if (w <= 0) return null;
        const hollow = slice.role === 'unclaimed';
        return (
          <rect
            key={slice.role}
            x={at.toFixed(2)}
            y="0"
            width={Math.max(0, w - 1).toFixed(2)}
            height={height}
            rx="3"
            fill={hollow ? 'transparent' : CLAIM_FILL[slice.role]}
            stroke={hollow ? 'color-mix(in srgb, var(--foreground) 32%, transparent)' : 'none'}
            strokeWidth={hollow ? 1.2 : 0}
            strokeDasharray={hollow ? '4 3' : undefined}
          />
        );
      })}
    </svg>
  );
}

import type { CSSProperties, ReactElement } from 'react';
import { cx, kitAttrs, stateClass, type Glyph, type KitState, type Tone } from './types';

export interface UnitSegment {
  /** Units this claim holds; a fraction draws a partially filled last unit. */
  n: number;
  tone?: Tone;
  glyph?: Glyph;
}

export type UnitSize = 's' | 'm' | 'l' | 'pip';

/**
 * UnitStrip: a quantity as countable units of a fixed quantum the caller chooses ("1 square =
 * 100k tokens"), coloured by who claims them. Zero draws one hollow placeholder. The grid flows
 * column-major so claims read left to right.
 * @catalog UnitStrip - a quantity as countable units of a fixed quantum, coloured by claim (apportion splits a total). Kit.
 */
export function UnitStrip({ segments, rows = 1, size = 'm', label, state }: {
  segments: readonly UnitSegment[];
  rows?: number;
  size?: UnitSize;
  label: string;
  state?: KitState;
}) {
  const units: ReactElement[] = [];
  let total = 0;
  segments.forEach((s, si) => {
    const n = Math.max(0, s.n || 0);
    const whole = Math.floor(n + 1e-9);
    const part = n - whole;
    total += n;
    const cls = `k-u t-${s.tone ?? 'neutral'}`;
    for (let i = 0; i < whole; i++) units.push(<i key={`${si}-${i}`} className={`${cls} g-${s.glyph ?? 'solid'}`} />);
    if (part > 0.04) {
      const style = { '--part': `${Math.max(12, Math.round(part * 100))}%` } as CSSProperties;
      units.push(<i key={`${si}-part`} className={`${cls} is-part`} style={style} />);
    }
  });
  const st: KitState = state ?? (total === 0 ? 'empty' : 'default');
  return (
    <span
      className={cx('k-units', `k-units--${size}`, stateClass(st))}
      {...kitAttrs('UnitStrip', st)}
      role="img"
      aria-label={label}
      style={{ '--rows': rows } as CSSProperties}
    >
      {total === 0 ? <i className="k-u" /> : units}
    </span>
  );
}

/** Split a total into units of `quantum`, each part's share coloured by its claim. */
export function apportion(parts: ReadonlyArray<{ value: number; tone: Tone; glyph?: Glyph }>, quantum: number): UnitSegment[] {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const exact = total / quantum;
  const whole = Math.floor(exact);
  const frac = exact - whole;
  const segs: UnitSegment[] = [];
  let acc = 0;
  let prevEnd = 0;
  for (const p of parts) {
    acc += p.value;
    const end = total ? Math.round((acc / total) * whole) : 0;
    segs.push({ n: end - prevEnd, tone: p.tone, glyph: p.glyph });
    prevEnd = end;
  }
  if (frac > 0.04 && segs.length) {
    let li = segs.length - 1;
    while (li > 0 && !parts[li]!.value) li--;
    segs[li]!.n += frac;
  }
  return segs;
}

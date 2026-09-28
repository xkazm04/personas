import { useId, type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
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
 *
 * `legend` (grow-2) states the quantum when it is more than one: what ONE unit stands for, in
 * the caller's words and noun ("5 runs", "100k tokens"; the caller words it, since only it knows
 * the noun, which is why there is no `auto`). The kit draws it beside the strip as one unit of
 * the first claim, then "= 5 runs", and wires it as the strip's description ("1 unit = 5 runs"),
 * so a reader hears the scale after the count and never twice.
 * @catalog UnitStrip - a quantity as countable units of a fixed quantum, coloured by claim, its quantum stated by legend (apportion, quantumFor). Kit.
 */
export function UnitStrip({ segments, rows = 1, size = 'm', label, state, legend, ...host }: {
  segments: readonly UnitSegment[];
  rows?: number;
  size?: UnitSize;
  label: string;
  state?: KitState;
  /** What one unit stands for ("5 runs"); give it when the quantum is more than one. */
  legend?: string;
  /** Forwarded for a Hint: the description and, when standalone, the tab stop. */
  'aria-describedby'?: string;
  tabIndex?: number;
}) {
  const legendId = useId();
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
  const described = legend ? [host['aria-describedby'], legendId].filter(Boolean).join(' ') : host['aria-describedby'];
  const strip = (
    <span
      className={cx('k-units', `k-units--${size}`, stateClass(st))}
      {...kitAttrs('UnitStrip', st)}
      role="img"
      aria-label={label}
      style={{ '--rows': rows } as CSSProperties}
      {...host}
      aria-describedby={described}
    >
      {total === 0 ? <i className="k-u" /> : units}
    </span>
  );
  if (!legend) return strip;
  const key = segments.find((s) => s.n > 0) ?? segments[0];
  return (
    <span className="k-units-legend">
      {strip}
      <UnitLegend id={legendId} size={size} tone={key?.tone} glyph={key?.glyph} value={legend} />
    </span>
  );
}

/** The quantum key: one unit drawn as the strip draws it, "= value", and the sentence a reader hears. */
function UnitLegend({ id, size, tone = 'neutral', glyph = 'solid', value }: { id: string; size: UnitSize; tone?: Tone; glyph?: Glyph; value: string }) {
  const { t, tx } = useTranslation();
  return (
    <>
      <span className="k-units__legend typo-caption" aria-hidden="true">
        <span className={`k-units k-units--${size}`}><i className={`k-u t-${tone} g-${glyph}`} /></span>
        <span>= {value}</span>
      </span>
      <span id={id} hidden>{tx(t.shared.unit_legend, { value })}</span>
    </>
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

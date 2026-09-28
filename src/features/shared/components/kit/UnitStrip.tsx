import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Hint } from './Hint';
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
 * the noun, which is why there is no `auto`). Nothing is drawn for it (owner, grow-2 gate: "Hover
 * only"): the strip becomes its own kit Hint, "1 unit = 5 runs" on hover and keyboard focus (a
 * tab stop, lifted above a pressable card's press so the pointer reaches it), and the same
 * sentence is its accessible description, merged with any description a caller forwards. Wrap a
 * legend strip in a caller Hint only for the description: its tip would stack on the legend's.
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
  const strip = (
    <span
      className={cx('k-units', `k-units--${size}`, stateClass(st), legend && 'k-units--hint')}
      {...kitAttrs('UnitStrip', st)}
      role="img"
      aria-label={label}
      style={{ '--rows': rows } as CSSProperties}
      {...host}
    >
      {total === 0 ? <i className="k-u" /> : units}
    </span>
  );
  return legend ? <LegendHint value={legend}>{strip}</LegendHint> : strip;
}

/** The legend's Hint: the kit string "1 unit = {value}" as the tip and the description. */
function LegendHint({ value, children }: { value: string; children: ReactElement<{ 'aria-describedby'?: string; tabIndex?: number }> }) {
  const { t, tx } = useTranslation();
  return <Hint content={tx(t.shared.unit_legend, { value })} focusable>{children}</Hint>;
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

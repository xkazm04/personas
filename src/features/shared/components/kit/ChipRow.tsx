import type { CSSProperties, ReactNode } from 'react';
import { Dot } from './Mark';
import { Ghost } from './states';
import { cx, kitAttrs, stateClass, type Glyph, type KitState, type Tone } from './types';

export interface Chip {
  id: string;
  label: ReactNode;
  count?: ReactNode;
  /** 0..1: a 2px share bar along the chip's foot. */
  share?: number;
  tone?: Tone;
  glyph?: Glyph;
  state?: KitState;
  /** Present = the chip is a button (a filter); absent = a static chip. */
  onPress?: () => void;
}

/** One 30px chip: glyph, label, count, share bar. Selected = an active filter.
 * @catalog ChipRow - 30px chips with count and share bar, a chip with onPress is a filter; ChipView is one chip (toolbar filter). Kit.
 */
export function ChipView({ chip: c }: { chip: Chip }) {
  const inner = (
    <>
      {c.glyph && <Dot tone={c.tone} glyph={c.glyph} />}
      {/* The chip's one emphasis is its name. The count is a step LARGER (typo-data is step 1,
        * typo-label step 0) and only the muting made it recede, so when muting weakened to 80%
        * (grow-4, part 8) the name took the weight instead - the lever the doctrine names. */}
      <span className="typo-label k-medium">{c.label}</span>
      {c.count != null && <span className="k-chip__count typo-data k-regular">{c.count}</span>}
      {c.share != null && <span className="k-chip__share" style={{ '--share': Math.min(1, Math.max(0, c.share)) } as CSSProperties} />}
    </>
  );
  const cls = cx('k-chip', stateClass(c.state));
  return c.onPress
    ? <button type="button" className={cls} aria-pressed={c.state === 'selected'} onClick={c.onPress}>{inner}</button>
    : <span className={cls}>{inner}</span>;
}

const GHOST_WIDTHS = [70, 90, 60, 80, 54];

/** ChipRow: owns chip height, count recipe and share bar; the caller owns what a press does.
 * @catalog ChipRow - 30px chips with count and share bar; a chip with onPress is a filter. Kit.
 */
export function ChipRow({ chips, label, emptyLabel, state }: {
  chips: readonly Chip[];
  label: string;
  emptyLabel: ReactNode;
  state?: KitState;
}) {
  const st: KitState = state === 'loading' ? 'loading' : chips.length === 0 ? 'empty' : state ?? 'default';
  return (
    <div className={cx('k-chips', stateClass(st))} {...kitAttrs('ChipRow', st)} role="group" aria-label={label}>
      {st === 'loading'
        ? GHOST_WIDTHS.map((w) => <span key={w} className="k-chip"><Ghost width={`${w}px`} /></span>)
        : st === 'empty'
          ? <span className="k-chip is-muted"><span className="typo-label k-regular">{emptyLabel}</span></span>
          : chips.map((c) => <ChipView key={c.id} chip={c} />)}
    </div>
  );
}

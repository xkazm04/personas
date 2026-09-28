import type { ReactNode } from 'react';
import { Mark } from './Mark';
import { emptyBand, GhostRows, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type Glyph, type KitStates, type Tone } from './types';

export type RowSize = 'line' | 's' | 'm' | 'l';

export interface ListRowProps {
  name: ReactNode;
  meta?: ReactNode;
  mark?: { tone: Tone; glyph?: Glyph; label: string };
  /** Figures, always regular weight; the caller says what they are. */
  figures?: ReactNode;
  time?: ReactNode;
  size?: RowSize;
  state?: KitStates;
  /** Overrides the one emphasised name recipe (`typo-body k-strong`). */
  nameClass?: string;
  /**
   * Present = the row presses (opens, launches, selects): its name becomes the row's one button,
   * its hit area stretched over the row; figures and time stay pressable above it. A selected
   * pressable row is the current one (`aria-current`). The row keeps its fixed height.
   */
  onPress?: () => void;
  testId?: string;
}

/**
 * ListRow: a fixed-height row on the 8px grid with ONE emphasised name, quiet meta and an
 * alternating band; its status mark sits on the spine and a selected row lights its segment. With
 * `onPress` (grow-2) the name is the row's one button, as a pressable ContextCard's title is:
 * one tab stop per row, the focus ring on the row, hover band and pointer over all of it.
 * @catalog ListRow - fixed-height row: one emphasised name, quiet meta, status mark on the spine, figures; onPress makes the name the row's one button. Kit.
 */
export function ListRow({ name, meta, mark, figures, time, size = 'm', state, nameClass, onPress, testId }: ListRowProps) {
  const trail = figures != null || time != null;
  const nameCls = cx('k-row__name', nameClass ?? 'typo-body k-strong');
  const selected = typeof state === 'string' ? state === 'selected' : !!state?.includes('selected');
  return (
    <div className={cx('k-row', `k-row--${size}`, stateClass(state), onPress && 'is-pressable')} {...kitAttrs('ListRow', state)} data-testid={testId}>
      {mark && <Mark tone={mark.tone} glyph={mark.glyph} label={mark.label} />}
      <div className="k-row__main">
        {onPress
          ? <button type="button" className={cx(nameCls, 'k-row__press')} aria-current={selected || undefined} onClick={onPress}>{name}</button>
          : <div className={nameCls}>{name}</div>}
        {meta != null && <div className="k-row__meta typo-caption">{meta}</div>}
      </div>
      {trail && (
        <div className="k-row__trail">
          {figures}
          {time != null && <span className="k-time typo-data k-regular k-quiet">{time}</span>}
        </div>
      )}
    </div>
  );
}

/** A list of rows, or its loading ghost, or its empty band: the list's three states; a pager under the last row.
 * @catalog Rows - a list of ListRows with its loading ghost, empty band and optional pager. Kit.
 */
export function Rows({ loading, empty, children, count, pager, label }: {
  loading?: boolean;
  empty: EmptySpec;
  /** Number of rows about to render; 0 renders the empty band. */
  count: number;
  children: ReactNode;
  /** Under the last row, as DataTable's pager (a "show all" or page control). */
  pager?: ReactNode;
  /** Accessible name of the pager. */
  label?: string;
}) {
  if (loading) return <GhostRows />;
  if (count === 0) return <>{emptyBand(empty)}</>;
  return (
    <>
      <div className="k-rows">{children}</div>
      {pager && <nav className="k-pager" aria-label={label}>{pager}</nav>}
    </>
  );
}

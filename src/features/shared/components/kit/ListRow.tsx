import { Children, type ReactNode } from 'react';
import { Mark } from './Mark';
import { CappedRows } from './RowsCap';
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
  /**
   * Overrides the one emphasised name recipe (`typo-body k-medium`). `typo-body k-strong` is the
   * declared exception: a white name at 600 where no tinted title is above it (see the emphasis
   * recipe on `ListRow`).
   */
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
 *
 * THE KIT'S EMPHASIS RECIPE (grow-4, part 5). **Weight 600 belongs to the TINTED title; a WHITE
 * name beside it reads at 500.** A kit list always hangs under a head that is already tinted and
 * 600 (`typo-section-title` on a Section, `typo-title` on a Tile), so a white 600 name under it
 * is a SECOND emphasis in the same voice on the same surface - the owner's 2026-10-03 reading,
 * "we have themed strong types and white strong types of texts; white text should have norm
 * weight". The row is not flattened by the move (Gate 3, "prevent monotone text"): the name still
 * stands off its meta by three things at once - a size step (`typo-body` is step 1, `typo-caption`
 * step 0), full ink against the one muting, and 500 against 400.
 *
 * The exception is explicit, never implicit: a name with no tinted title above it on its surface
 * passes `nameClass="typo-body k-strong"` and keeps 600. `.k-strong` itself is untouched; only the
 * kit's DEFAULT recipe moved.
 * @catalog ListRow - fixed-height row: one emphasised name (500; 600 is the tinted title's), quiet meta, status mark on the spine, figures; onPress makes the name the row's one button. Kit.
 */
export function ListRow({ name, meta, mark, figures, time, size = 'm', state, nameClass, onPress, testId }: ListRowProps) {
  const trail = figures != null || time != null;
  const nameCls = cx('k-row__name', nameClass ?? 'typo-body k-medium');
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
 * `cap` (grow-3) shows the first `cap` rows and a "Show all N" control that expands the list in place.
 * @catalog Rows - a list of ListRows with its loading ghost, empty band, optional pager and an in-place "Show all" cap. Kit.
 */
export function Rows({ loading, empty, children, count, pager, label, cap }: {
  loading?: boolean;
  empty: EmptySpec;
  /** Number of rows about to render; 0 renders the empty band. */
  count: number;
  children: ReactNode;
  /** Under the last row, as DataTable's pager (a "show all" or page control). */
  pager?: ReactNode;
  /** Accessible name of the pager. */
  label?: string;
  /** Show the first `cap` rows and a "Show all N" control that expands in place (the page scrolls). */
  cap?: number;
}) {
  if (loading) return <GhostRows />;
  if (count === 0) return <>{emptyBand(empty)}</>;
  if (cap != null && Children.count(children) > cap) return <CappedRows cap={cap} pager={pager} label={label}>{children}</CappedRows>;
  return (
    <>
      <div className="k-rows">{children}</div>
      {pager && <nav className="k-pager" aria-label={label}>{pager}</nav>}
    </>
  );
}

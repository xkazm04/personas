import { Children, type ReactNode } from 'react';
import { Mark } from './Mark';
import { RowCells, RowList, type RowColumn } from './RowColumns';
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
  /**
   * The row's metadata SPREAD into the columns its `Rows` list declared, one node per column, in
   * the list's order (grow-4, part 2). Without a declared column set the row keeps its two-cell
   * shape and this is ignored, which is why no existing caller changes.
   */
  cells?: readonly ReactNode[];
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
export function ListRow({ name, meta, mark, figures, cells, time, size = 'm', state, nameClass, onPress, testId }: ListRowProps) {
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
      {cells && <RowCells cells={cells} />}
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
 *
 * `columns` (grow-4) gives the list REAL columns: the caller declares the track set ONCE on the
 * list and each row fills it through `cells`, so a row's metadata spreads into aligned columns
 * instead of stacking under the name and leaving the band empty across a wide surface (owner,
 * 2026-10-03: "no columns used and creating empty space over passing metadata from rows to
 * spread"). The two-cell shape stays the DEFAULT, so no existing caller changes; a column's
 * content ellipsizes rather than wrapping, so the fixed row height survives (Gate 2b); and the set
 * collapses against the LIST's own width, as `.k-grp` does, so a list inside a narrow tile
 * collapses even on a wide surface.
 *
 * `nameWidth` (home-3) lets the caller declare the NAME track too. A column list's name track takes
 * everything the columns leave, which on a 1920 surface opened ~950px of empty band between the
 * name and the first column (measured on `kit/specimen/grow-4`, 2026-10-03); with a width the name
 * is a track like any other and the leftover room moves to the trail, which keeps its right edge.
 * Without it nothing changes, so every current caller keeps the behaviour it has.
 * @catalog Rows - a list of ListRows with its loading ghost, empty band, optional pager, an in-place "Show all" cap, an optional declared column set the rows fill and an optional declared name track. Kit.
 */
export function Rows({ loading, empty, children, count, pager, label, cap, columns, nameHead, nameWidth }: {
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
  /** The columns every row of this list fills through `ListRow cells`. */
  columns?: readonly RowColumn[];
  /** The name column's head; with it (or any column head) the list draws a head line. */
  nameHead?: ReactNode;
  /**
   * The name column's own track, a CSS length or `fr` (`'26rem'`), used only by a list that also
   * declares `columns`. Without it the name takes everything the columns leave, which is what every
   * list did before and still does.
   */
  nameWidth?: string;
}) {
  if (loading) return <GhostRows />;
  if (count === 0) return <>{emptyBand(empty)}</>;
  if (cap != null && Children.count(children) > cap) {
    return <CappedRows cap={cap} pager={pager} label={label} columns={columns} nameHead={nameHead} nameWidth={nameWidth}>{children}</CappedRows>;
  }
  if (columns) return <RowList columns={columns} nameHead={nameHead} nameWidth={nameWidth} label={label} pager={pager}>{children}</RowList>;
  return (
    <>
      <div className="k-rows">{children}</div>
      {pager && <nav className="k-pager" aria-label={label}>{pager}</nav>}
    </>
  );
}

// RailRowView — THE row of the Activity desk's Reviews tab (and any rail feed
// that is not a message thread: those draw `RailThreadRow`).
//
// ## It wears the Board rail's row (2026-10-05 fuse)
//
// The look is the Board's `NeedsRail` row, from the Board's own stylesheet
// (`fb-rail__row`, `fb-rail__bar`, `fb-ink`): a tone bar on the leading edge, a
// framed face, the title in `typo-body`, a toned `typo-label` line under it,
// and the age trailing in its own column. The tone arrives as `--fb-tone` (`railToneVar`): the
// Board's own colours where the row is a persona needing you, the deck's kind
// tone where it is not. The persona's identity colour is its FACE, not the
// bar — the bar says state, as it does on the Board.
//
// ## The two-line contract
//
// LINE 1 IS THE TITLE AND NOTHING ELSE: at rail width every character spent on
// a chip or a timestamp is one the title loses before its verb. LINE 2 is where
// it came from, toned. The KIND is carried by a glyph, never a word (except
// where `RailRow.showKind` says a colour could not teach it): the glyph is the
// face when the row has no persona, and leads line 2 when a persona's face
// took that slot.
//
// The verdict buttons trail LINE 2, not the row: the owner judged a full-width
// title over the source, with both verdicts in reach, the better review row,
// and a trailing column would cost every title their width. Only a timed row
// (`showTime`) fills the Board's trailing column, with its age; the two never
// meet, since a decidable row is a backlog entry and prints no time.
//
// ## Read and unread
//
// Only feeds with a watermark (`RailRow.tracksRead`) step read rows back, and
// by opacity alone: a second hue down this column would read as a second KIND
// of row, not the same row read. Dimming a review for not being "read" would
// dim the whole tab to mean nothing.
//
// ## Why the verdict buttons are on the row
//
// Most of a triage pass is "yes, obviously" and "no, obviously"; putting them
// one click from the list keeps the rail a working surface. They carry NO
// reason prompt on purpose — anything that needs an argument should be opened.
//
// ## Height
//
// A row's height is DECIDED here and nowhere else, because `RailList`
// virtualizes from it: {@link railRowHeight}, the Board rail's 56px plus the
// project band a group's first row wears (the band is a grid track inside the
// row, so the list keeps ONE entry per index).

import '../../fleetboard/fleetboard.css';
import { memo, type CSSProperties } from 'react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RailCheckbox, RailFace, RailTime, RailUnread, RailVerdicts, railToneVar } from './RailBits';
import type { RailRow } from './railModel';

/** The Board rail's row: a `md` framed face (36) inside `typo-body` + `typo-label`
 *  (~23 + ~17). Fed to BOTH the virtualizer and the row, so the two cannot drift. */
export const RAIL_ROW_HEIGHT = 56;

/** The project band a group's first row wears above itself: `typo-label` on
 *  one line plus its own padding. */
export const RAIL_GROUP_HEADER_HEIGHT = 26;

/** What this row occupies. The ONE height authority (see the header). */
export function railRowHeight(row: RailRow): number {
  return RAIL_ROW_HEIGHT + (row.groupHeader ? RAIL_GROUP_HEADER_HEIGHT : 0);
}

export const RailRowView = memo(function RailRowView({
  row, selected, onToggle, onOpen, onAccept, onReject,
}: {
  row: RailRow;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const Icon = row.icon;
  const openable = !!onOpen;
  const toggles = row.selectable && !!onToggle;
  const canDecide = row.decidable && !!onAccept && !!onReject;

  const body = (
    <>
      {/* The project band: the row's first grid track, spanning every column.
          Not `sticky` — inside an absolutely-positioned virtual row it would
          stick to the row, not the scroller. */}
      {row.groupHeader && (
        <span
          className="col-span-full flex items-center gap-1.5 self-stretch border-b border-border pb-1 typo-label text-foreground opacity-70"
          data-testid="rail-group-header"
        >
          {/* The board column's own colour: the band and the column it names
              are the same thing seen twice. */}
          {row.accent && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: colorWithAlpha(row.accent, 0.85) }}
            />
          )}
          <span className="min-w-0 truncate">{row.groupHeader}</span>
        </span>
      )}
      <i className="fb-rail__bar" aria-hidden />
      <span className="flex items-center gap-1.5">
        {toggles && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} />}
        <RailFace row={row} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <RailUnread unread={row.unread} />
          <span className={`min-w-0 flex-1 truncate typo-body text-foreground ${row.tracksRead && !row.unread ? 'opacity-50' : ''}`}>
            {row.title}
          </span>
          {/* On screen the kind is a glyph; the word is here for assistive tech. */}
          {!row.showKind && <span className="sr-only">{row.kind}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1 typo-label fb-ink">
          {row.persona && <Icon className="h-3 w-3 flex-shrink-0" aria-hidden />}
          {row.source && <span className="min-w-0 truncate">{row.source}</span>}
          {row.showKind && (
            <>
              {row.source && <span aria-hidden>·</span>}
              <span className="flex-shrink-0">{row.kind}</span>
            </>
          )}
          {canDecide && (
            <span className="ml-auto flex items-center pl-1">
              <RailVerdicts row={row} onAccept={onAccept} onReject={onReject} />
            </span>
          )}
        </span>
      </span>
      {row.showTime && !canDecide && <RailTime at={row.at} className="typo-label text-foreground" />}
    </>
  );

  const cls = `fb-rail__row mx-1${selected ? ' is-lit' : ''}`;
  const style = {
    '--fb-tone': railToneVar(row.tone),
    ...(row.groupHeader ? { gridTemplateRows: `${RAIL_GROUP_HEADER_HEIGHT}px minmax(0, 1fr)` } : null),
    ...(openable || toggles ? null : { cursor: 'default' }),
  } as CSSProperties;

  // The `data-testid` rides on ALL THREE branches: a row missing it is on
  // screen and invisible to every test and tour anchor that addresses rows.
  if (toggles) {
    return <label className={cls} style={style} data-testid="rail-row">{body}</label>;
  }
  // A div-with-role rather than a <button>: the verdict buttons are
  // interactive, and a button inside a button is invalid HTML.
  return openable ? (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(row)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpen?.(row);
      }}
      className={cls}
      style={style}
      data-testid="rail-row"
    >
      {body}
    </div>
  ) : (
    <div className={cls} style={style} data-testid="rail-row">{body}</div>
  );
});

export default RailRowView;

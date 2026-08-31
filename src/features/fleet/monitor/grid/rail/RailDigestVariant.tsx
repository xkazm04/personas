// VARIANT C — DIGEST. A briefing, not a list.
//
// METAPHOR: the morning digest. A 60-row queue is not sixty equal things, it is
// "4 reviews, 12 ideas, 44 practices" — and the feed and the ledger both hide
// that, because both render an undifferentiated scroll where the only way to
// learn the shape of your backlog is to read all of it.
//
// THE ONE MOVE: SECTION BANDS. Rows arrive weight-sorted, which already clusters
// them by kind; wherever the kind changes, the row draws a band above itself
// carrying the kind and how many of it are in this run. So the queue answers
// "what am I facing" before you read a single title, and the tab badge stops
// being the only number on the surface.
//
// The bands are drawn INLINE by the row (`rows[index - 1]` decides), not spliced
// into the model as synthetic header rows — see `RailList.renderRow`. That keeps
// grouping a presentation decision and keeps `railModel` free of it.
//
// TYPOGRAPHY + WEIGHT. No borders between rows at all. Separation is whitespace
// and a hover wash; the only rules on the surface are the section bands, so a
// rule MEANS something. The title is `typo-body` at full `text-foreground` —
// brighter and larger than either other variant's first line — and the meta line
// is a single muted `typo-caption`. A leading tone dot replaces both the feed's
// icon and the ledger's gutter: at this density the kind is already stated by
// the band you are sitting under, so restating it per row is noise.
//
// The trade: 58px per row plus 24px per band, the tallest of the three. It shows
// fewer rows per screen and reads better while doing it. That is the whole
// argument — a rail you actually read beats a rail that fits more.

import { memo } from 'react';
import { RailCheckbox, RailTime, RailUnread } from './RailBits';
import { TONE_FILL, TONE_TEXT, type RailRow } from './railModel';

export const DIGEST_ROW_HEIGHT = 58;
export const DIGEST_BAND_HEIGHT = 24;

/** True when this row opens a new section. The one place the rule lives — both
 *  the renderer and the height function read it, so they cannot disagree about
 *  which rows are tall (a virtualizer that disagrees misplaces everything below
 *  the first band). */
export function opensSection(rows: RailRow[], index: number): boolean {
  const row = rows[index];
  if (!row) return false;
  return index === 0 || rows[index - 1]?.kind !== row.kind;
}

/** Height function for `RailList`, closed over the current rows. */
export function digestRowHeight(rows: RailRow[]): (index: number) => number {
  return (index) => DIGEST_ROW_HEIGHT + (opensSection(rows, index) ? DIGEST_BAND_HEIGHT : 0);
}

/** How many consecutive rows share this row's kind, starting here. */
function runLength(rows: RailRow[], index: number): number {
  const kind = rows[index]?.kind;
  let n = 0;
  for (let i = index; i < rows.length && rows[i]?.kind === kind; i += 1) n += 1;
  return n;
}

export const DigestRow = memo(function DigestRow({
  row, rows, index, selected, onToggle, onOpen,
}: {
  row: RailRow;
  rows: RailRow[];
  index: number;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
}) {
  const interactive = !!onOpen && !row.selectable;
  const band = opensSection(rows, index);

  const body = (
    <>
      <span className="flex items-center gap-2">
        {row.selectable && onToggle && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} />}
        <span aria-hidden className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${TONE_FILL[row.tone]}`} />
        <RailUnread unread={row.unread} />
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{row.title}</span>
      </span>
      <span className="mt-0.5 flex items-baseline gap-1.5 pl-[14px] typo-caption text-foreground opacity-55">
        {row.source && <span className="min-w-0 truncate">{row.source}</span>}
        {row.source && row.body && <span aria-hidden>·</span>}
        {row.body && <span className="min-w-0 flex-1 truncate">{row.body}</span>}
        <RailTime at={row.at} className="ml-auto" />
      </span>
    </>
  );

  const cls = `block w-full rounded-interactive px-2.5 py-1.5 text-left transition-colors ${
    selected ? 'bg-primary/10' : interactive || row.selectable ? 'hover:bg-foreground/[0.04]' : ''
  }`;

  return (
    <div className="px-1.5">
      {band && (
        <div
          className="flex h-6 items-center gap-1.5 border-b border-border px-1"
          data-testid="rail-section-band"
        >
          <span className={`typo-label uppercase tracking-wider ${TONE_TEXT[row.tone]}`}>{row.kind}</span>
          <span className="ml-auto typo-caption tabular-nums text-foreground opacity-45">
            {runLength(rows, index)}
          </span>
        </div>
      )}
      {row.selectable && onToggle ? (
        <label className={`${cls} cursor-pointer`}>{body}</label>
      ) : interactive ? (
        <button type="button" onClick={() => onOpen?.(row)} className={cls} data-testid="rail-row">
          {body}
        </button>
      ) : (
        <div className={cls} data-testid="rail-row">{body}</div>
      )}
    </div>
  );
});

export default DigestRow;

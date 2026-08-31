// VARIANT B — LEDGER. A record, not a conversation.
//
// METAPHOR: an engineering log book. Every row is an ENTRY with the same three
// columns in the same three places, so the eye reads DOWN a column instead of
// across a row. Nothing is a chip, nothing is a pill, nothing changes width
// with its label.
//
// THE ONE MOVE that makes it different from the feed: the kind becomes a
// GUTTER COLUMN — a fixed 34px monospace slot carrying a 3-letter code (REV /
// IDE / MSG / DSP), tone-coloured, with a hairline down its right edge. Chips
// are what make a narrow list ragged: their width tracks their label, so name,
// kind and time never line up two rows running. A fixed gutter costs the same
// 34px on every row and gives it back as a scan axis — you can find every
// review in a 60-row queue without reading one word.
//
// TYPOGRAPHY. The title is `typo-body` (14px, weight 400) at full
// `text-foreground` — the thing being judged is the thing you read, so it gets
// the readable tier and none of the muting. Everything else is `typo-caption`
// on a single meta line. Two type sizes for the whole list; the feed uses three
// (label, caption, chip) in the same 320px.
//
// DENSITY. 50px against the feed's 54, and it fits MORE title, because the
// gutter is out of the text flow and the meta line is one row instead of a
// wrapped chip. The trade it makes: no avatars. At this width a 12px face is a
// coloured smudge, and the persona's name is already on the meta line.

import { memo } from 'react';
import { RailCheckbox, RailTime, RailUnread } from './RailBits';
import { TONE_TEXT, type RailRow } from './railModel';

/** `typo-body` line (14 x 1.65 = 23) + `typo-caption` meta (12 x 1.5 = 18) +
 *  py-1 (8) + the 1px rule. */
export const LEDGER_ROW_HEIGHT = 50;

export const LedgerRow = memo(function LedgerRow({
  row, selected, onToggle, onOpen,
}: {
  row: RailRow;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
}) {
  const interactive = !!onOpen && !row.selectable;

  const body = (
    <>
      {/* THE GUTTER. Fixed width, right-aligned, hairline on its trailing edge.
          `select-none` because the code is a marker, not content anyone would
          want to copy out of a log. */}
      <span
        aria-hidden
        className={`flex h-full w-[34px] flex-shrink-0 select-none items-start justify-end border-r border-border pr-1.5 pt-[3px] font-mono text-[11px] leading-none tracking-tight ${TONE_TEXT[row.tone]}`}
      >
        {row.code}
      </span>
      {/* The kind is `aria-hidden` above — a 3-letter code is not a label, so
          the full kind rides here for anyone who is not reading the gutter. */}
      <span className="sr-only">{row.kind}</span>

      <span className="min-w-0 flex-1 pl-2">
        <span className="flex items-baseline gap-1.5">
          {row.selectable && onToggle && (
            <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} className="self-center" />
          )}
          <RailUnread unread={row.unread} />
          <span className="min-w-0 flex-1 truncate typo-body text-foreground">{row.title}</span>
        </span>
        <span className="flex items-baseline gap-1.5 typo-caption text-foreground opacity-55">
          {row.source && <span className="min-w-0 truncate">{row.source}</span>}
          {row.source && row.body && <span aria-hidden>·</span>}
          {row.body && <span className="min-w-0 flex-1 truncate">{row.body}</span>}
          <RailTime at={row.at} className="ml-auto" />
        </span>
      </span>
    </>
  );

  const cls = `flex w-full items-stretch border-b border-border py-1 pr-2.5 text-left transition-colors ${
    selected ? 'bg-primary/10' : interactive || row.selectable ? 'hover:bg-secondary/40' : ''
  }`;

  if (row.selectable && onToggle) {
    return <label className={`${cls} cursor-pointer`}>{body}</label>;
  }
  return interactive ? (
    <button type="button" onClick={() => onOpen?.(row)} className={cls} data-testid="rail-row">
      {body}
    </button>
  ) : (
    <div className={cls} data-testid="rail-row">{body}</div>
  );
});

export default LedgerRow;

// RailRowView — THE row of the Activity rail. One component, three tabs.
//
// Winner of the 2026-08-31 /prototype round (against LEDGER, a fixed monospace
// kind gutter, and DIGEST, section bands per kind). It began as the Messages row
// and now draws reviews, dispatchable ideas and channel activity alike — which
// is the actual unification: not that the three tabs were restyled to match, but
// that there is only one row left to style.
//
// ## The two-line contract (2026-08-31, round 2)
//
// LINE 1 IS THE TITLE AND NOTHING ELSE. It gets the row's full width, its
// readable type tier, and full-strength foreground. Everything that used to
// compete with it there — the relative time, the source, the kind chip — moved
// down. The reason is arithmetic: at 320px the rail can show roughly 38
// characters, and a chip plus a timestamp on the same line was eating fifteen of
// them, so most titles truncated inside their first clause. A title that
// truncates before its verb is not a title, it is a hint that you have to open
// the row to read it — which defeats a rail whose whole job is to let you decide
// what to open.
//
// LINE 2 IS EVERYTHING ELSE, muted: where it came from, and then — pushed to
// the trailing edge — either the two verdict buttons or the timestamp. The
// instant used to LEAD that line, which put the least decision-relevant thing
// on the row in the first place the eye lands after the title. It reads better
// last and it is not printed at all on the two tabs that are backlogs rather
// than chronologies (`RailRow.showTime`).
//
// ## Groups, and why the header is a band inside the row
//
// The Messages tab is ordered by project. A group's first row draws the
// project name above itself rather than the list interleaving separate header
// elements, for one reason: `RailList` virtualizes on an index, and two kinds
// of entry in one index space is how a virtualized list starts misplacing
// things. One entry type, a variable height, one `railRowHeight` both the
// virtualizer and the row are measured from.
//
// ## Read and unread are not the same weight
//
// A merged channel feed is mostly history. Rendering all of it at one weight
// makes the four lines that are actually new indistinguishable from the four
// hundred that are not, which is the whole job of the tab. Unread titles keep
// full-strength foreground and gain medium weight; read ones step back. Only
// feeds that HAVE a watermark do this (`RailRow.tracksRead`) — dimming a review
// for not being "read" would dim the Reviews tab to mean nothing.
//
// ## Why the verdict buttons are here and not in a menu
//
// The rail's Reviews tab is a queue of things blocking work. Most of a triage
// pass is "yes, obviously" and "no, obviously"; only the ambiguous minority
// needs the card. Putting accept/reject one click from the list is what keeps
// the rail a working surface rather than an index into a modal. The buttons
// carry NO reason prompt on purpose — a quick verdict is the one that needed no
// argument, and anything that needs an argument should be opened.
//
// ## What did not change
//
// The state colour is still a full-height rail on the leading edge, the persona
// still gets a face where it has one, and a row's height is still DECIDED here
// and nowhere else, because `RailList` virtualizes from it — a row that grows
// with its content misplaces every row below it. What changed is that the
// height is a function ({@link railRowHeight}) rather than a constant, since a
// group's opening row wears a band the others do not.

import { memo } from 'react';
import { Check, X } from 'lucide-react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useTranslation } from '@/i18n/useTranslation';
import { RailAvatar, RailCheckbox, RailTime, RailUnread } from './RailBits';
import { TONE_TEXT, type RailRow } from './railModel';

/**
 * `typo-body` title line (14 × 1.65 ≈ 23) + `typo-caption` meta line (~18) +
 * py-1.5 (12) + the 1px rule. Fed to BOTH the virtualizer and the row from
 * here, so the two cannot drift.
 */
export const RAIL_ROW_HEIGHT = 56;

/** The project band a group's first row wears above itself: `typo-label` on
 *  one line plus its own padding. */
export const RAIL_GROUP_HEADER_HEIGHT = 26;

/**
 * What this row occupies. The ONE height authority — `RailList` measures the
 * virtualizer from it and the row element is sized by it, so a group band that
 * grew here could not silently misplace every row beneath it.
 */
export function railRowHeight(row: RailRow): number {
  return RAIL_ROW_HEIGHT + (row.groupHeader ? RAIL_GROUP_HEADER_HEIGHT : 0);
}

/** The two quick verdicts. Icon-only — at rail width a labelled button pair
 *  would take the whole meta line, and the icons are the app's own verdict
 *  glyphs (the triage card stamps the same check and cross). */
const VerdictButtons = memo(function VerdictButtons({
  row, onAccept, onReject,
}: {
  row: RailRow;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const stop = (e: React.MouseEvent) => {
    // The row itself opens the card. A verdict is not an "open", so the click
    // must not reach the row — without this, accepting from the rail would also
    // throw the modal up over the queue you were working down.
    e.stopPropagation();
    e.preventDefault();
  };
  const base =
    'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-interactive border transition-colors';
  return (
    <span className="ml-1 flex flex-shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={(e) => { stop(e); onAccept(row.id); }}
        aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}
        data-testid="rail-row-accept"
        className={`${base} border-status-success/30 text-status-success hover:bg-status-success/15`}
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => { stop(e); onReject(row.id); }}
        aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}
        data-testid="rail-row-reject"
        className={`${base} border-status-error/30 text-status-error hover:bg-status-error/15`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
});

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
  const canDecide = row.decidable && !!onAccept && !!onReject;

  const body = (
    <>
      {/* The project band. Inside the row, above its own content, so the list
          keeps ONE entry per index (see the header). `sticky` is deliberately
          NOT used: a sticky band inside an absolutely-positioned virtual row
          sticks to the row, not the scroller, which looks like a bug. */}
      {row.groupHeader && (
        <span
          className="flex items-center gap-1.5 border-b border-border pb-1 typo-label text-foreground opacity-70"
          style={{ height: RAIL_GROUP_HEADER_HEIGHT }}
          data-testid="rail-group-header"
        >
          {/* The board column's own colour. The band and the column it names
              are the same thing seen twice, and a shared accent is what says
              so without a second label. */}
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
      {/* The state rail — the whole leading edge, so a column reads as a colour
          strip you can scan without reading a word. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-0.5 ${row.accent ? '' : TONE_TEXT[row.tone].replace('text-', 'bg-')}`}
        style={row.accent ? { backgroundColor: colorWithAlpha(row.accent, 0.7) } : undefined}
      />

      {/* LINE 1 — the title, and only the title. */}
      <span className="flex items-center gap-1.5">
        {row.selectable && onToggle && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} />}
        {row.persona ? (
          <RailAvatar row={row} size="w-3.5 h-3.5" />
        ) : (
          <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${TONE_TEXT[row.tone]}`} aria-hidden />
        )}
        <RailUnread unread={row.unread} />
        {/* Read steps BACK; unread is simply left alone. The difference is
            carried by opacity and nothing else, and that is not a stylistic
            preference — it is the only axis available here:
              • WEIGHT is unavailable. `typo-*` sets `font-weight` from an
                UNLAYERED rule, so it beats Tailwind's `@layer utilities` and
                `typo-body font-medium` is a silent no-op (typography.css says
                so twice, in as many words). Emphasis is meant to move up a
                token instead — but `typo-title` also changes line-height 1.65
                → 1.4 and tints the colour, which would make every unread row
                lay out three pixels shorter than its neighbours in a list whose
                heights are fixed and measured.
              • HUE is available and wrong: a second colour down this column
                reads as a second KIND of row, not the same row unread.
            Rows from a feed with no watermark are never stepped back at all —
            see `tracksRead`. */}
        <span
          className={`min-w-0 flex-1 truncate typo-body text-foreground ${
            row.tracksRead && !row.unread ? 'opacity-50' : ''
          }`}
        >
          {row.title}
        </span>
        {/* The kind is on screen only where a colour could not teach it (see
            `RailRow.showKind`); everywhere else it is here for assistive tech
            alone, because an icon is not a label. */}
        {!row.showKind && <span className="sr-only">{row.kind}</span>}
      </span>

      {/* LINE 2 — where it came from, then the trailing slot. The two things
          that can occupy that slot (a verdict pair, an instant) never occur on
          the same row: a decidable row is a backlog entry and prints no time,
          a timed row is a message and has no verdict. */}
      <span className="mt-0.5 flex items-center gap-1.5 pl-5 typo-caption text-foreground opacity-55">
        {row.source && <span className="min-w-0 truncate">{row.source}</span>}
        {row.showKind && (
          <>
            {row.source && <span aria-hidden>·</span>}
            <span className={`flex-shrink-0 ${TONE_TEXT[row.tone]}`}>{row.kind}</span>
          </>
        )}
        {canDecide ? (
          <span className="ml-auto flex items-center">
            <VerdictButtons row={row} onAccept={onAccept} onReject={onReject} />
          </span>
        ) : (
          row.showTime && <RailTime at={row.at} className="ml-auto" />
        )}
      </span>
    </>
  );

  const cls = `relative block w-full border-b border-border px-2.5 py-1.5 pl-3 text-left transition-colors ${
    selected ? 'bg-primary/10' : openable || row.selectable ? 'hover:bg-secondary/40' : ''
  }`;

  // The `data-testid` rides on ALL THREE branches, not just the two that are
  // buttons. It was missing on the label branch once, and the tell was that the
  // Dispatch tab's badge said 1 while a `[data-testid="rail-row"]` query
  // returned 0 — a row on screen and invisible to every test and tour anchor
  // that addresses rows.
  if (row.selectable && onToggle) {
    return <label className={`${cls} cursor-pointer`} data-testid="rail-row">{body}</label>;
  }
  // A div-with-role rather than a <button>: the verdict buttons on line 2 are
  // interactive, and nesting a button inside a button is invalid HTML that
  // browsers resolve by dropping one of them.
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
      className={`${cls} focus-ring cursor-pointer`}
      data-testid="rail-row"
    >
      {body}
    </div>
  ) : (
    <div className={cls} data-testid="rail-row">{body}</div>
  );
});

export default RailRowView;

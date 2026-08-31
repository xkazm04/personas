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
// LINE 2 IS EVERYTHING ELSE, muted: when, where from, and — for rows that carry
// a verdict — the two buttons that resolve it without opening anything.
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
// still gets a face where it has one, and rows are still a fixed
// {@link RAIL_ROW_HEIGHT} because `RailList` virtualizes them — a row that grows
// with its content misplaces every row below it.

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
        <span className="min-w-0 flex-1 truncate typo-body text-foreground">{row.title}</span>
        {/* The kind is on screen only where a colour could not teach it (see
            `RailRow.showKind`); everywhere else it is here for assistive tech
            alone, because an icon is not a label. */}
        {!row.showKind && <span className="sr-only">{row.kind}</span>}
      </span>

      {/* LINE 2 — when, where, and the verdicts. */}
      <span className="mt-0.5 flex items-center gap-1.5 pl-5 typo-caption text-foreground opacity-55">
        <RailTime at={row.at} />
        {row.source && (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate">{row.source}</span>
          </>
        )}
        {row.showKind && (
          <>
            <span aria-hidden>·</span>
            <span className={`flex-shrink-0 ${TONE_TEXT[row.tone]}`}>{row.kind}</span>
          </>
        )}
        {canDecide && (
          <span className="ml-auto flex items-center">
            <VerdictButtons row={row} onAccept={onAccept} onReject={onReject} />
          </span>
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

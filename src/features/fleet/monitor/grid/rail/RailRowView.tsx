// RailRowView — THE row of the Activity rail. One component, three tabs.
//
// Winner of the 2026-08-31 /prototype round (against LEDGER, a fixed monospace
// kind gutter, and DIGEST, section bands per kind). It began as the Messages
// row and now draws reviews, dispatchable ideas and channel activity alike —
// which is the actual unification: not that the three tabs were restyled to
// match, but that there is only one row left to style.
//
// THE ROW'S ARGUMENT: every item in this rail is something SOMEONE did or is
// waiting on. So the row leads with WHO — a persona face where there is one, the
// kind's icon where there is not — carries a coloured hairline on its leading
// edge for WHERE, and puts the instant on the right, where a messenger puts it.
// The second line is the sentence: a message body, an idea's flattened summary,
// or the source when neither exists.
//
// THE KNOWN TRADE, kept deliberately rather than discovered later: the kind is a
// tinted chip, and a chip's width tracks its label, so the name/kind/time triple
// does not align down the column. The LEDGER variant existed to answer exactly
// that with a fixed gutter, and it was not chosen — alignment down a 320px
// column was worth less than reading who did it at a glance. If that judgment
// ever flips, `git show 525b7eb81` has the gutter implementation intact.
//
// Rows are a fixed {@link RAIL_ROW_HEIGHT} because `RailList` virtualizes them:
// a row that grows with its content misplaces every row below it. Both lines
// therefore truncate, and the full text is one click away on the surface that
// owns it.

import { memo } from 'react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RailAvatar, RailCheckbox, RailTime, RailUnread } from './RailBits';
import { TONE_TEXT, type RailRow } from './railModel';

/** Two lines of `typo-caption` (12px x 1.5) plus 8px of padding plus the rule.
 *  Fed to BOTH the virtualizer and the row, from here, so the two cannot drift. */
export const RAIL_ROW_HEIGHT = 54;

export const RailRowView = memo(function RailRowView({
  row, selected, onToggle, onOpen,
}: {
  row: RailRow;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
}) {
  const Icon = row.icon;
  const interactive = !!onOpen && !row.selectable;

  const body = (
    <>
      {/* Source hairline — the team/persona colour, or the tone when the row
          has no owner of its own. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-0.5 ${row.accent ? '' : TONE_TEXT[row.tone].replace('text-', 'bg-')}`}
        style={row.accent ? { backgroundColor: colorWithAlpha(row.accent, 0.7) } : undefined}
      />
      <span className="flex items-center gap-1.5">
        {row.selectable && onToggle && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} />}
        {row.persona ? <RailAvatar row={row} size="w-3 h-3" /> : <Icon className={`h-3 w-3 flex-shrink-0 ${TONE_TEXT[row.tone]}`} aria-hidden />}
        <RailUnread unread={row.unread} />
        <span className="min-w-0 truncate typo-label text-foreground">{row.title}</span>
        <span className={`min-w-0 flex-shrink truncate typo-caption ${TONE_TEXT[row.tone]}`}>{row.kind}</span>
        <RailTime at={row.at} className="ml-auto typo-caption text-foreground opacity-50" />
      </span>
      <span className="mt-0.5 block truncate typo-caption text-foreground opacity-60">
        {row.body ?? row.source ?? ''}
      </span>
    </>
  );

  const cls = `relative block w-full border-b border-border px-2.5 py-1.5 pl-3 text-left transition-colors ${
    selected ? 'bg-primary/10' : interactive || row.selectable ? 'hover:bg-secondary/40' : ''
  }`;

  // The `data-testid` rides on ALL THREE branches, not just the two that were
  // buttons. It was missing here, and the tell was that the Dispatch tab's badge
  // said 1 while a `[data-testid="rail-row"]` query returned 0 — a row that is
  // on screen and invisible to every test and tour anchor that addresses rows.
  if (row.selectable && onToggle) {
    return <label className={`${cls} cursor-pointer`} data-testid="rail-row">{body}</label>;
  }
  return interactive ? (
    <button type="button" onClick={() => onOpen?.(row)} className={cls} data-testid="rail-row">
      {body}
    </button>
  ) : (
    <div className={cls} data-testid="rail-row">{body}</div>
  );
});

export default RailRowView;

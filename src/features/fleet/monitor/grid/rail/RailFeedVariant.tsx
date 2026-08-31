// VARIANT A — FEED. The baseline: the Messages row, applied to all three tabs.
//
// METAPHOR: a messenger timeline. Every row is something SOMEONE did, so the
// row leads with who, carries a coloured hairline for where, and puts the
// instant on the right where a chat client puts it. The kind is a tinted chip
// beside the name.
//
// This is the variant to beat, not the target. It is here because the user
// named the Messages tab as the one that already read well, and because a
// baseline that is genuinely the current design is the only honest A/B — a
// straw-man baseline makes every new direction look good.
//
// Its known weakness, stated so the comparison is fair: the chip is a ragged
// element in a narrow column. Chip widths vary with the kind label, so name,
// chip and time never line up down the list, and at 320px the chip eats the
// width the name wanted. Variants B and C are two different answers to that.

import { memo } from 'react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RailAvatar, RailCheckbox, RailTime, RailUnread } from './RailBits';
import { TONE_TEXT, type RailRow } from './railModel';

/** Two lines of `typo-caption` (12px x 1.5) plus 8px of padding plus the rule. */
export const FEED_ROW_HEIGHT = 54;

export const FeedRow = memo(function FeedRow({
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

export default FeedRow;

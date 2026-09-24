// Departures · LogRow — one entry in the Log (the rail). PROTOTYPE (variant C).
//
//   ■ An SCA challenge carries the amount into the
//     signature payload and …                                    (≤2 lines)
//     bank-edge                                    Accept · Reject | 3m
//
// Two title lines instead of one, because the title IS the decision; the
// verdicts are words (revealed on hover / focus), not 20px glyph buttons.
// Read rows step back in opacity — weight utilities lose to the unlayered
// `typo-*` rule (see RailRowView), so opacity is the only honest axis.

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RailAvatar, RailCheckbox, RailTime } from '../../rail/RailBits';
import { TONE_FILL, TONE_TEXT, type RailRow } from '../../rail/railModel';

const LINE = 23;
const META = 21;
const PAD = 12;
const GROUP = 26;
/** Rough glyph width of `typo-body` — only decides one line vs two. */
const CHAR_W = 7.2;

/** The row height authority, fed to both the virtualiser and the row. */
export function logRowHeight(row: RailRow, width: number): number {
  const perLine = Math.max(12, Math.floor((width - 44) / CHAR_W));
  const lines = row.title.length > perLine ? 2 : 1;
  return PAD + LINE * lines + META + 1 + (row.groupHeader ? GROUP : 0);
}

export const LogRow = memo(function LogRow({
  row, height, selected, onToggle, onOpen, onAccept, onReject,
}: {
  row: RailRow;
  height: number;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const canDecide = row.decidable && !!onAccept && !!onReject;
  const read = row.tracksRead && !row.unread;
  const verb = 'focus-ring rounded-interactive px-1.5 typo-label transition-colors hover:bg-secondary/50';

  const body = (
    <>
      {row.groupHeader && (
        <span className="flex items-center gap-1.5 border-b border-border/50 typo-label uppercase tracking-wide text-foreground opacity-60" style={{ height: GROUP }}>
          {row.groupHeader}
        </span>
      )}
      <span className="flex items-start gap-2 pt-1.5">
        {row.selectable && onToggle && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} className="mt-1" />}
        {row.persona ? (
          <span className="mt-1 flex-shrink-0"><RailAvatar row={row} size="w-3.5 h-3.5" /></span>
        ) : (
          <span
            aria-hidden
            className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-none ${row.accent ? '' : TONE_FILL[row.tone]}`}
            style={row.accent ? { backgroundColor: colorWithAlpha(row.accent, 0.85) } : undefined}
          />
        )}
        <span className={`line-clamp-2 min-w-0 flex-1 typo-body text-foreground ${read ? 'opacity-50' : ''}`}>{row.title}</span>
        {row.unreadCount !== undefined && row.unreadCount > 0 && (
          <span className="mt-0.5 flex-shrink-0 typo-data tabular-nums text-primary">{row.unreadCount}</span>
        )}
        {!row.showKind && <span className="sr-only">{row.kind}</span>}
      </span>
      <span className="flex items-center gap-2 pl-3.5 typo-caption text-foreground">
        {row.source && <span className="min-w-0 truncate opacity-55">{row.source}</span>}
        {row.showKind && <span className={`flex-shrink-0 ${TONE_TEXT[row.tone]}`}>{row.kind}</span>}
        {canDecide ? (
          <span className="ml-auto flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAccept(row.id); }}
              aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}
              data-testid="rail-row-accept"
              className={`${verb} text-status-success`}
            >
              {t.monitor.triage_accept}
            </button>
            <span aria-hidden className="opacity-30">·</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onReject(row.id); }}
              aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}
              data-testid="rail-row-reject"
              className={`${verb} text-status-error`}
            >
              {t.monitor.triage_reject}
            </button>
          </span>
        ) : (
          row.showTime && <RailTime at={row.at} className="ml-auto opacity-55" />
        )}
      </span>
    </>
  );

  const cls = `group relative block w-full overflow-hidden border-b border-border/40 px-3 text-left transition-colors ${
    selected ? 'bg-primary/10' : 'hover:bg-secondary/30'
  }`;
  if (row.selectable && onToggle) {
    return <label className={`${cls} cursor-pointer`} style={{ height }} data-testid="rail-row">{body}</label>;
  }
  if (!onOpen) return <div className={cls} style={{ height }} data-testid="rail-row">{body}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpen(row);
      }}
      className={`${cls} focus-ring cursor-pointer`}
      style={{ height }}
      data-testid="rail-row"
    >
      {body}
    </div>
  );
});

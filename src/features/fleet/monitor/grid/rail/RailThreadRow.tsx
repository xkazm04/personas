// RailThreadRow — a Messages thread in the rail, messenger-inbox style.
//
// Same height authority as every other rail row (`railRowHeight`, since a
// thread row never opens a group), so `RailList` virtualizes it unchanged.
//
//   LINE 1 — the counterpart's face (persona icon, or the team / system glyph),
//            its name, and the time of the latest line at the trailing edge.
//   LINE 2 — the latest line as a one-line preview, and the unread count pill.
//
// UNREAD IS WEIGHT. `typo-*` sets `font-weight` from an unlayered rule that
// beats any Tailwind weight utility (see `RailRowView`), so the unread name is
// set bold through the element's own style, which outranks both, and the line
// height stays the body token's so every row keeps the measured height. Read
// threads step back by opacity, exactly as read rows always have.

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RailAvatar, RailTime } from './RailBits';
import { TONE_TEXT, type RailRow } from './railModel';

const BOLD = { fontWeight: 600 } as const;

export const RailThreadRow = memo(function RailThreadRow({
  row, onOpen,
}: {
  row: RailRow;
  onOpen?: (row: RailRow) => void;
}) {
  const { t, tx } = useTranslation();
  const Icon = row.icon;
  const count = row.unreadCount ?? 0;
  const open = () => onOpen?.(row);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        open();
      }}
      className="focus-ring relative block h-full w-full cursor-pointer border-b border-border px-2.5 py-1.5 pl-3 text-left transition-colors hover:bg-secondary/40"
      data-testid="rail-row"
      data-thread-unread={count > 0 ? true : undefined}
    >
      {row.accent && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ backgroundColor: colorWithAlpha(row.accent, 0.7) }}
        />
      )}
      <span className="flex items-center gap-1.5">
        {row.persona ? (
          <RailAvatar row={row} size="w-3.5 h-3.5" />
        ) : (
          <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${TONE_TEXT[row.tone]}`} aria-hidden />
        )}
        <span
          className={`min-w-0 flex-1 truncate typo-body text-foreground ${count > 0 ? '' : 'opacity-60'}`}
          style={count > 0 ? BOLD : undefined}
        >
          {row.title}
        </span>
        <RailTime at={row.at} className="typo-caption text-foreground opacity-55" />
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 pl-5 typo-caption text-foreground">
        <span className={`min-w-0 flex-1 truncate ${count > 0 ? 'opacity-80' : 'opacity-50'}`}>
          {row.body}
        </span>
        {count > 0 && (
          <span
            className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1 typo-label tabular-nums text-primary-foreground"
            aria-label={tx(t.monitor.grid_rail_thread_unread_aria, { count })}
            data-testid="rail-thread-unread"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
    </div>
  );
});

/** The Messages tab's one control: unread threads only, or every thread. */
export function RailThreadFilter({
  showAll, onChange, hidden,
}: {
  showAll: boolean;
  onChange: (showAll: boolean) => void;
  /** Read threads the unread-only view is hiding. */
  hidden: number;
}) {
  const { t, tx } = useTranslation();
  const chip = (on: boolean) =>
    `focus-ring rounded-interactive px-2 py-0.5 typo-label transition-colors ${
      on ? 'bg-secondary/50 text-foreground' : 'text-foreground opacity-55 hover:opacity-90'
    }`;
  return (
    <div
      className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-border px-2"
      role="group"
      aria-label={t.monitor.grid_rail_thread_filter_aria}
    >
      <button type="button" aria-pressed={!showAll} onClick={() => onChange(false)} className={chip(!showAll)} data-testid="rail-threads-unread">
        {t.monitor.grid_rail_threads_unread}
      </button>
      <button type="button" aria-pressed={showAll} onClick={() => onChange(true)} className={chip(showAll)} data-testid="rail-threads-all">
        {t.monitor.grid_rail_threads_all}
      </button>
      {!showAll && hidden > 0 && (
        <span className="ml-auto typo-caption text-foreground opacity-50">
          {tx(t.monitor.grid_rail_threads_hidden, { count: hidden })}
        </span>
      )}
    </div>
  );
}

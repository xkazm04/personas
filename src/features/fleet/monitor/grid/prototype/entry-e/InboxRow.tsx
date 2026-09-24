// One inbox row: the same glass window as a persona, its lamp the row's tone.
// The title gets two full lines at body size, because a review IS its title.
// The verdict pair appears on the row you are on (hover or keyboard focus),
// labelled, and answers to A and R there - not two 20px glyphs on every row.

import { memo, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { RailRow } from '../../rail/railModel';
import { toneClass, triageTone } from './tone';
import { Lamp } from './parts';

/** The one height authority for the virtualiser: two title lines + a meta line. */
export const INBOX_ROW_H = 96;
export const inboxRowHeight = (): number => INBOX_ROW_H;

export const InboxRow = memo(function InboxRow({
  row, selected, onToggle, onOpen, onAccept, onReject,
}: {
  row: RailRow;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const tone = triageTone(row.tone);
  const lit = row.unread || tone === 'err' || tone === 'warn';
  const canDecide = row.decidable && !!onAccept && !!onReject;
  const dim = row.tracksRead && !row.unread;

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === 'Enter' || e.key === ' ') && onOpen) { e.preventDefault(); onOpen(row); }
    else if (e.key === ' ' && onToggle) { e.preventDefault(); onToggle(row.id); }
    else if ((e.key === 'a' || e.key === 'A') && canDecide) { e.preventDefault(); onAccept!(row.id); }
    else if ((e.key === 'r' || e.key === 'R') && canDecide) { e.preventDefault(); onReject!(row.id); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const li = e.currentTarget.closest('li');
      const next = (e.key === 'ArrowDown' ? li?.nextElementSibling : li?.previousElementSibling) as HTMLElement | null;
      next?.querySelector<HTMLElement>('[data-inbox-row]')?.focus();
    }
  };

  return (
    <div className="h-full px-2 py-1">
      <div
        role={onOpen || onToggle ? 'button' : undefined}
        tabIndex={0}
        data-inbox-row
        data-testid="rail-row"
        aria-pressed={row.selectable ? !!selected : undefined}
        onClick={() => (onToggle ? onToggle(row.id) : onOpen?.(row))}
        onKeyDown={onKey}
        className={`ae-win ae-row ae-focus relative flex h-full cursor-pointer flex-col justify-between gap-1 rounded-input px-2.5 py-2 ${toneClass(tone)} ${
          row.unread ? 'is-lit' : ''} ${selected ? 'is-selected' : ''}`}
      >
        <span className="flex min-w-0 items-start gap-2">
          {row.selectable && onToggle ? (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggle(row.id)}
              onClick={(e) => e.stopPropagation()}
              aria-label={tx(t.monitor.triage_accepted_row_aria, { title: row.title })}
              className="mt-[5px] h-3.5 w-3.5 flex-shrink-0 cursor-pointer accent-primary"
              tabIndex={-1}
            />
          ) : (
            <Lamp lamp={{ tone, lit }} className="mt-[7px]" />
          )}
          <span className={`ae-clamp2 min-w-0 flex-1 typo-body ${dim ? 'text-foreground/85' : 'text-foreground'}`}>{row.title}</span>
          {row.unread && (row.unreadCount ?? 0) > 0 && (
            <span className="mt-0.5 flex-shrink-0 rounded-pill bg-status-info/15 px-1.5 typo-caption tabular-nums text-status-info">{row.unreadCount}</span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-[18px] typo-caption">
          <row.icon className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{[row.source, row.showKind ? row.kind : null].filter(Boolean).join(' · ')}</span>
          {!row.showKind && <span className="sr-only">{row.kind}</span>}
          {canDecide ? (
            <span className="ae-reveal absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-input bg-background/90 p-0.5 shadow-elevation-1">
              <Button
                variant="accent" tone="success" size="xs"
                onClick={(e) => { e.stopPropagation(); onAccept!(row.id); }}
                aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}
                data-testid="rail-row-accept"
                icon={<Check className="h-3 w-3" />}
              >
                {t.monitor.approve}
              </Button>
              <Button
                variant="accent" tone="error" size="xs"
                onClick={(e) => { e.stopPropagation(); onReject!(row.id); }}
                aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}
                data-testid="rail-row-reject"
                icon={<X className="h-3 w-3" />}
              >
                {t.common.reject}
              </Button>
            </span>
          ) : row.showTime && row.at !== null ? (
            <RelativeTime timestamp={row.at} showTooltip={false} className="ml-auto flex-shrink-0 tabular-nums" />
          ) : null}
        </span>
      </div>
    </div>
  );
});

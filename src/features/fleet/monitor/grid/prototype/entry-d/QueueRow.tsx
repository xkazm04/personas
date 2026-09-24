// A dispatch waiting outside the rack. Its rank is the big numeral (the same
// Q-number its plate prints on the board), its wait is drawn as a bar against
// the longest wait in the queue, and a not-before gate reads as a clock. The
// verbs sit in their own column and answer the keyboard: Alt+arrows move it,
// S starts it past the cap, Delete cancels (both through the confirm dialog).

import { memo, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Clock, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { useRoom } from './rackModel';

export const QUEUE_ROW_H = 58;

function walk(from: HTMLElement, delta: 1 | -1) {
  const list = Array.from(document.querySelectorAll<HTMLElement>('[data-queue-row]'));
  list[list.indexOf(from) + delta]?.focus();
}

export const QueueRow = memo(function QueueRow({
  item, rank, first, last, maxWaitMs, now, onNudge, onStart, onCancel, compact = false,
}: {
  item: QueueItem;
  rank: number;
  first: boolean;
  last: boolean;
  maxWaitMs: number;
  now: number;
  onNudge: (id: string, delta: -1 | 1) => void;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
  compact?: boolean;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const facts = useSessionFacts()(item.session, item);
  const { hot, setHot, focusKey } = useRoom();
  const est = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const notBefore = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });
  const gated = item.notBeforeMs !== null && item.notBeforeMs > now;
  const wait = item.estimatedStartMs !== null ? Math.max(0, item.estimatedStartMs - now) : null;
  const Origin = facts.OriginIcon;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); if (!first) onNudge(item.sessionId, -1); return; }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); if (!last) onNudge(item.sessionId, 1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); walk(e.currentTarget, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); walk(e.currentTarget, -1); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); onStart(item); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onCancel(item); }
  };

  return (
    <div
      role="listitem"
      tabIndex={0}
      data-queue-row
      onKeyDown={onKey}
      onMouseEnter={() => setHot(item.sessionId)}
      onMouseLeave={() => setHot(null)}
      aria-label={[tx(s.queue_rank_aria, { rank }), facts.label, facts.project].filter(Boolean).join(', ')}
      data-testid="fleet-queue-row"
      data-hot={hot === item.sessionId || undefined}
      className={`ed-intake-row ed-row focus-ring flex items-center gap-3 px-3 ${focusKey === `s:${item.sessionId}` ? 'ed-flash' : ''}`}
      style={{ height: QUEUE_ROW_H }}
    >
      <span className={`w-9 flex-shrink-0 text-right tabular-nums text-foreground ${compact ? 'typo-data' : 'typo-data-lg'}`}>{rank}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate typo-body text-foreground">{facts.label}</span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption">
          <Origin className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span className="truncate">{[facts.originLabel, facts.project].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      {!compact && (
        <div className="flex w-44 flex-shrink-0 flex-col items-end gap-1">
          <span className={`flex items-center gap-1 truncate typo-caption tabular-nums ${gated ? 'text-status-info' : ''}`}>
            {gated && <Clock className="h-3 w-3" aria-hidden />}
            {gated ? tx(s.queue_not_before, { time: notBefore })
              : item.estimatedStartMs !== null ? tx(s.queue_estimated_start, { time: est }) : s.queue_no_estimate}
          </span>
          <span className="ed-wait w-full rounded-full" aria-hidden>
            {wait !== null && maxWaitMs > 0 && <span className="rounded-full" style={{ width: `${Math.max(3, Math.round((wait / maxWaitMs) * 100))}%` }} />}
          </span>
        </div>
      )}
      <div className="ed-verdicts flex flex-shrink-0 items-center gap-0.5">
        <Tooltip content={s.queue_move_up}>
          <Button variant="ghost" size="icon-sm" disabled={first} onClick={() => onNudge(item.sessionId, -1)} aria-label={s.queue_move_up}
            data-testid="fleet-queue-up" icon={<ChevronUp className="h-4 w-4" aria-hidden />} />
        </Tooltip>
        <Tooltip content={s.queue_move_down}>
          <Button variant="ghost" size="icon-sm" disabled={last} onClick={() => onNudge(item.sessionId, 1)} aria-label={s.queue_move_down}
            data-testid="fleet-queue-down" icon={<ChevronDown className="h-4 w-4" aria-hidden />} />
        </Tooltip>
        <Tooltip content={s.queue_start_now}>
          <Button variant="accent" tone="warning" size="icon-sm" onClick={() => onStart(item)} aria-label={s.queue_start_now}
            data-testid="fleet-queue-start-now" icon={<Zap className="h-4 w-4" aria-hidden />} />
        </Tooltip>
        <Tooltip content={s.queue_cancel}>
          <Button variant="ghost" size="icon-sm" onClick={() => onCancel(item)} aria-label={s.queue_cancel}
            data-testid="fleet-queue-cancel" icon={<X className="h-4 w-4" aria-hidden />} />
        </Tooltip>
      </div>
    </div>
  );
});

// Departures · ScheduledLine — one queued session on the "Scheduled" board.
// PROTOTYPE (variant C).
//
//   #03  Session title ………… project   ✦ Athena   ETA 14:32   ↑ ↓ Start now · Cancel
//
// The verbs sit at the line's right end and appear on hover / focus; the ETA
// is the door's ESTIMATE (never a measurement), so it keeps the "ETA" word and
// falls back to "No estimate" rather than inventing a time.

import { memo } from 'react';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { pad2 } from './parts';

const VERB = 'focus-ring rounded-interactive px-1.5 py-0.5 typo-label text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-25';

export const ScheduledLine = memo(function ScheduledLine({
  item, position, first, last, flash, compact = false, onNudge, onStart, onCancel,
}: {
  item: QueueItem;
  /** 1-based painted position (the optimistic order). */
  position: number;
  first: boolean;
  last: boolean;
  flash: boolean;
  compact?: boolean;
  onNudge: (id: string, delta: -1 | 1) => void;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const f = useSessionFacts()(item.session, item);
  const eta = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const notBefore = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });
  const gated = item.notBeforeMs !== null && item.notBeforeMs > Date.now();
  const OriginIcon = f.OriginIcon;

  return (
    <div
      role="listitem"
      className={`group relative flex items-center gap-2.5 border-b border-border/30 px-2 py-1 transition-colors hover:bg-secondary/30 focus-within:bg-secondary/30 ${
        flash ? 'ring-1 ring-inset ring-primary' : ''
      }`}
      data-testid="fleet-queue-row"
      data-rank={item.rank ?? undefined}
    >
      <span className="w-8 flex-shrink-0 typo-data tabular-nums text-foreground opacity-60" aria-label={tx(s.queue_rank_aria, { rank: position })}>
        #{pad2(position)}
      </span>
      <span className="min-w-0 flex-1 truncate typo-body text-foreground">{f.label}</span>
      {!compact && f.project && (
        <span className="hidden w-36 flex-shrink-0 truncate typo-caption text-foreground opacity-60 xl:block">{f.project}</span>
      )}
      {compact ? (
        <Tooltip content={f.originLabel}>
          <OriginIcon className="h-3.5 w-3.5 flex-shrink-0 text-foreground opacity-60" aria-hidden />
        </Tooltip>
      ) : (
        <span className="inline-flex w-28 flex-shrink-0 items-center gap-1.5 typo-caption text-foreground opacity-70">
          <OriginIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="truncate">{f.originLabel}</span>
        </span>
      )}
      {gated && (
        <Tooltip content={tx(s.queue_not_before, { time: notBefore })}>
          <span className="inline-flex flex-shrink-0 items-center gap-1 typo-caption tabular-nums text-status-warning">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {notBefore}
          </span>
        </Tooltip>
      )}
      <Tooltip content={item.estimatedStartMs !== null ? tx(s.queue_estimated_start, { time: eta }) : s.queue_no_estimate}>
        <span className="w-20 flex-shrink-0 text-right typo-data tabular-nums text-foreground opacity-80">
          {item.estimatedStartMs !== null ? eta : '—'}
        </span>
      </Tooltip>
      <span className={`flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
        compact ? 'absolute right-1 top-1/2 -translate-y-1/2 rounded-interactive bg-background shadow-elevation-2' : ''
      }`}>
        <Tooltip content={s.queue_move_up}>
          <button type="button" className={VERB} disabled={first} onClick={() => onNudge(item.sessionId, -1)} aria-label={s.queue_move_up} data-testid="fleet-queue-up">
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content={s.queue_move_down}>
          <button type="button" className={VERB} disabled={last} onClick={() => onNudge(item.sessionId, 1)} aria-label={s.queue_move_down} data-testid="fleet-queue-down">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
        <button type="button" className={`${VERB} text-primary`} onClick={() => onStart(item)} data-testid="fleet-queue-start-now">
          {s.queue_start_now}
        </button>
        <button type="button" className={`${VERB} hover:text-status-error`} onClick={() => onCancel(item)} data-testid="fleet-queue-cancel">
          {s.queue_cancel}
        </button>
      </span>
    </div>
  );
});

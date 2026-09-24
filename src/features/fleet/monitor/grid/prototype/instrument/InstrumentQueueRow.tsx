// InstrumentQueueRow — one queued dispatch as a ranked mono line:
//   #01  title                               ETA 14:32   ⏳ gate   origin   ↑ ↓ ⚡ ✕
// The verbs are always reachable by keyboard and brighten on hover; start-now
// and cancel go through the shared confirm, exactly as the baseline's tile.

import { memo } from 'react';
import { ChevronDown, ChevronUp, Clock, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { bay } from './parts';

const KEY = 'focus-ring inline-flex h-6 w-6 items-center justify-center rounded-interactive border border-primary/10 text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 disabled:opacity-25 disabled:hover:bg-transparent';

export const InstrumentQueueRow = memo(function InstrumentQueueRow({
  item, index, first, last, compact = false, flash = false, onNudge, onStart, onCancel,
}: {
  item: QueueItem;
  index: number;
  first: boolean;
  last: boolean;
  /** Lanes: title on its own line, meta below. */
  compact?: boolean;
  flash?: boolean;
  onNudge: (id: string, delta: -1 | 1) => void;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const f = useSessionFacts()(item.session, item);
  const eta = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const gate = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });
  const gated = item.notBeforeMs !== null && item.notBeforeMs > Date.now();
  const Origin = f.OriginIcon;
  const rank = item.rank ?? index + 1;

  const meta = (
    <span className="flex flex-shrink-0 items-center gap-3 typo-code text-foreground">
      <span className="tabular-nums opacity-80">
        {item.estimatedStartMs !== null ? tx(s.queue_estimated_start, { time: eta }) : s.queue_no_estimate}
      </span>
      {gated && (
        <Tooltip content={tx(s.queue_not_before, { time: gate })}>
          <span className="inline-flex items-center gap-1 text-status-warning">
            <Clock className="h-3.5 w-3.5" aria-hidden />{gate}
          </span>
        </Tooltip>
      )}
      <span className="inline-flex items-center gap-1 opacity-60">
        <Origin className="h-3.5 w-3.5" aria-hidden />{f.originLabel}
      </span>
    </span>
  );

  const keys = (
    <span className="flex flex-shrink-0 items-center gap-1 opacity-40 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Tooltip content={s.queue_move_up}>
        <button type="button" className={KEY} disabled={first} onClick={() => onNudge(item.sessionId, -1)} aria-label={s.queue_move_up} data-testid="fleet-queue-up">
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content={s.queue_move_down}>
        <button type="button" className={KEY} disabled={last} onClick={() => onNudge(item.sessionId, 1)} aria-label={s.queue_move_down} data-testid="fleet-queue-down">
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content={s.queue_start_now}>
        <button type="button" className={`${KEY} hover:text-primary`} onClick={() => onStart(item)} aria-label={s.queue_start_now} data-testid="fleet-queue-start-now">
          <Zap className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content={s.queue_cancel}>
        <button type="button" className={`${KEY} hover:text-status-error`} onClick={() => onCancel(item)} aria-label={s.queue_cancel} data-testid="fleet-queue-cancel">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tooltip>
    </span>
  );

  return (
    <div
      role="listitem"
      className={`group relative flex gap-3 border-b border-primary/[0.07] px-2 py-2 transition-colors hover:bg-foreground/[0.03] ${
        compact ? 'flex-col items-stretch' : 'items-center'
      } ${flash ? 'ring-2 ring-primary' : ''}`}
      data-testid="fleet-queue-row"
      data-rank={item.rank ?? undefined}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="w-8 flex-shrink-0 typo-code tabular-nums text-primary" aria-label={tx(s.queue_rank_aria, { rank })}>#{bay(rank)}</span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 typo-body text-foreground">{f.label}</span>
          {f.project && <span className="block truncate typo-code text-foreground opacity-50">{f.project}</span>}
        </span>
      </span>
      <span className={`flex items-center gap-3 ${compact ? 'justify-between pl-11' : ''}`}>
        {meta}
        {keys}
      </span>
    </div>
  );
});

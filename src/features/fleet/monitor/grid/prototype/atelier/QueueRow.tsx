// Atelier "Up next" row — the rank in a soft bubble, the session title with
// its project and origin under it, the ETA (or the not-before gate) on the
// right. The verbs — ↑ ↓, Start now, Cancel — surface as ghost buttons on
// hover / focus, so a resting queue reads as a clean list.

import { memo } from 'react';
import { ChevronDown, ChevronUp, Clock, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';

const ICON_BTN = 'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-interactive text-foreground opacity-75 transition-colors hover:bg-secondary/55 hover:opacity-100 disabled:opacity-25';

export const QueueRow = memo(function QueueRow({
  item, first, last, flash, compact = false, onNudge, onStart, onCancel,
}: {
  item: QueueItem;
  first: boolean;
  last: boolean;
  flash: boolean;
  /** Lanes: no ↑/↓ text labels, narrower. */
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
      className={`group/q flex items-center gap-3 rounded-input px-3 py-2 transition-colors hover:bg-secondary/35 focus-within:bg-secondary/35 ${flash ? 'ring-2 ring-primary' : ''}`}
      data-testid="fleet-queue-row"
      data-rank={item.rank ?? undefined}
    >
      <span className="inline-flex h-7 min-w-7 flex-shrink-0 items-center justify-center rounded-pill bg-secondary/50 px-2 typo-data tabular-nums text-foreground" aria-label={item.rank !== null ? tx(s.queue_rank_aria, { rank: item.rank }) : s.queue_rank_unknown}>
        {item.rank ?? '·'}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 typo-body text-foreground">{f.label}</span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground opacity-65">
          <OriginIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="truncate">{[f.originLabel, f.project].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
      <span className="flex flex-shrink-0 flex-col items-end typo-caption text-foreground">
        {gated ? (
          <span className="inline-flex items-center gap-1 text-status-warning"><Clock className="h-3.5 w-3.5" aria-hidden />{tx(s.queue_not_before, { time: notBefore })}</span>
        ) : item.estimatedStartMs !== null ? (
          <span className="tabular-nums opacity-80">{tx(s.queue_estimated_start, { time: eta })}</span>
        ) : (
          <span className="opacity-50">{s.queue_no_estimate}</span>
        )}
      </span>
      <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/q:opacity-100">
        <Tooltip content={s.queue_move_up}>
          <button type="button" className={ICON_BTN} disabled={first} onClick={() => onNudge(item.sessionId, -1)} aria-label={s.queue_move_up} data-testid="fleet-queue-up">
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content={s.queue_move_down}>
          <button type="button" className={ICON_BTN} disabled={last} onClick={() => onNudge(item.sessionId, 1)} aria-label={s.queue_move_down} data-testid="fleet-queue-down">
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        {compact ? (
          <Tooltip content={s.queue_start_now}>
            <button type="button" className={ICON_BTN} onClick={() => onStart(item)} aria-label={s.queue_start_now} data-testid="fleet-queue-start-now">
              <Zap className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        ) : (
          <Button variant="ghost" size="xs" icon={<Zap className="h-3.5 w-3.5" aria-hidden />} onClick={() => onStart(item)} data-testid="fleet-queue-start-now">
            {s.queue_start_now}
          </Button>
        )}
        <Tooltip content={s.queue_cancel}>
          <button type="button" className={`${ICON_BTN} hover:text-status-error`} onClick={() => onCancel(item)} aria-label={s.queue_cancel} data-testid="fleet-queue-cancel">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      </span>
    </div>
  );
});

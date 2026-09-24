// The queue as a LADDER: rank is a numeral you can read across the room, and
// the wait is drawn - a bar whose length is the estimated wait against the
// longest one in the queue, with the not-before gate as a fence on it. The
// verbs sit on the rung they act on and go through the confirm dialogs.

import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Clock, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { QueueItem } from '../../board/queue/useQueueModel';
import type { LocalOrder } from '../../board/queue/useLocalOrder';
import { useSessionFacts } from '../shared';
import { Lamp } from './parts';

const Rung = memo(function Rung({
  item, index, total, maxWait, now, compact, flash, onNudge, onStart, onCancel,
}: {
  item: QueueItem;
  index: number;
  total: number;
  maxWait: number;
  now: number;
  compact: boolean;
  flash: boolean;
  onNudge: (id: string, delta: -1 | 1) => void;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const f = useSessionFacts()(item.session, item);
  const est = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const gate = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });
  const gated = item.notBeforeMs !== null && item.notBeforeMs > now;
  const wait = item.estimatedStartMs !== null ? Math.max(0, item.estimatedStartMs - now) : null;
  const gateAt = gated ? Math.max(0, item.notBeforeMs! - now) : null;
  const Origin = f.OriginIcon;
  const rank = item.rank ?? index + 1;

  return (
    <div
      className={`ae-win ae-row group flex min-w-0 items-stretch gap-3 rounded-input py-2 pl-2 pr-2 ${flash ? 'is-flash' : ''}`}
      data-testid="fleet-queue-row"
      data-rank={rank}
      aria-label={tx(m.queue_rank_aria, { rank })}
    >
      <span className="flex w-9 flex-shrink-0 items-start justify-center typo-data-lg tabular-nums text-foreground" aria-hidden>
        {rank}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-start gap-2">
          <Lamp lamp={{ tone: 'info', lit: false }} className="mt-[7px]" />
          <span className={`${compact ? 'ae-clamp2' : 'truncate'} min-w-0 flex-1 typo-body text-foreground`}>{f.label}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-[18px] typo-caption">
          <span className="inline-flex items-center gap-1"><Origin className="h-3 w-3" aria-hidden />{f.originLabel}</span>
          {f.project && !compact && <span className="truncate">{f.project}</span>}
          <span className="tabular-nums text-foreground">
            {item.estimatedStartMs !== null ? tx(m.queue_estimated_start, { time: est }) : m.queue_no_estimate}
          </span>
          {gated && (
            <span className="inline-flex items-center gap-1 text-status-warning">
              <Clock className="h-3 w-3" aria-hidden />{tx(m.queue_not_before, { time: gate })}
            </span>
          )}
        </span>
        {maxWait > 0 && (
          <span className="relative ml-[18px] mt-0.5 block h-1.5 rounded-full bg-foreground/[0.07]" aria-hidden>
            {wait !== null && (
              <span className="absolute inset-y-0 left-0 rounded-full bg-status-info/70" style={{ width: `${Math.max(3, (wait / maxWait) * 100)}%` }} />
            )}
            {gateAt !== null && (
              <span className="absolute -inset-y-1 w-0.5 bg-status-warning" style={{ left: `${Math.min(100, (gateAt / maxWait) * 100)}%` }} />
            )}
          </span>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-0.5">
        <Tooltip content={m.queue_move_up}>
          <Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onNudge(item.sessionId, -1)} aria-label={m.queue_move_up} data-testid="fleet-queue-up" icon={<ChevronUp className="h-4 w-4" />} />
        </Tooltip>
        <Tooltip content={m.queue_move_down}>
          <Button variant="ghost" size="icon-sm" disabled={index === total - 1} onClick={() => onNudge(item.sessionId, 1)} aria-label={m.queue_move_down} data-testid="fleet-queue-down" icon={<ChevronDown className="h-4 w-4" />} />
        </Tooltip>
        <Tooltip content={m.queue_start_now}>
          <Button variant="accent" tone="info" size="icon-sm" onClick={() => onStart(item)} aria-label={m.queue_start_now} data-testid="fleet-queue-start-now" icon={<Zap className="h-3.5 w-3.5" />} />
        </Tooltip>
        <Tooltip content={m.queue_cancel}>
          <Button variant="ghost" size="icon-sm" onClick={() => onCancel(item)} aria-label={m.queue_cancel} data-testid="fleet-queue-cancel" icon={<X className="h-4 w-4" />} />
        </Tooltip>
      </div>
    </div>
  );
});

export function QueueLadder({
  order, now, compact = false, focusKey, reducedMotion, onStart, onCancel,
}: {
  order: LocalOrder;
  now: number;
  compact?: boolean;
  focusKey: string | null;
  reducedMotion: boolean;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t } = useTranslation();
  const items = order.items;
  const maxWait = items.reduce((mx, i) => Math.max(
    mx,
    i.estimatedStartMs !== null ? i.estimatedStartMs - now : 0,
    i.notBeforeMs !== null ? i.notBeforeMs - now : 0,
  ), 0);

  return (
    <div role="list" aria-label={t.monitor.queue_reorder_aria} className="flex flex-col gap-1.5" data-testid="fleet-queue-strip">
      <AnimatePresence initial={false}>
        {items.map((item, i) => (
          <motion.div
            key={item.sessionId}
            role="listitem"
            layout={!reducedMotion}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: 0.2 }}
          >
            <Rung
              item={item}
              index={i}
              total={items.length}
              maxWait={maxWait}
              now={now}
              compact={compact}
              flash={focusKey === `s:${item.sessionId}`}
              onNudge={order.nudge}
              onStart={onStart}
              onCancel={onCancel}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

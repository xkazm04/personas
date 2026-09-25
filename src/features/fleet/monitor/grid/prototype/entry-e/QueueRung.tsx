// One rung of the queue ladder. Full (Runway): grip, a big rank numeral, the
// title, a meta line (origin, project, estimated start, not-before gate) and the
// wait drawn as a bar, with the four verbs at the right. Compact (Lanes): the
// same two-row line every other lane uses, the verbs revealed on hover/focus.

import { memo, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Clock, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { useSessionMenu } from './SessionMenu';

export const QueueRung = memo(function QueueRung({
  item, index, total, maxWait, now, compact, flash, lifted = false, grip, onNudge, onStart, onCancel,
}: {
  item: QueueItem;
  index: number;
  total: number;
  maxWait: number;
  now: number;
  compact: boolean;
  flash: boolean;
  lifted?: boolean;
  grip: ReactNode;
  onNudge: (id: string, delta: -1 | 1) => void;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const f = useSessionFacts()(item.session, item);
  const menu = useSessionMenu(item.session);
  const est = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const gate = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });
  const gated = item.notBeforeMs !== null && item.notBeforeMs > now;
  const wait = item.estimatedStartMs !== null ? Math.max(0, item.estimatedStartMs - now) : null;
  const gateAt = gated ? Math.max(0, item.notBeforeMs! - now) : null;
  const Origin = f.OriginIcon;
  const rank = item.rank ?? index + 1;
  const eta = item.estimatedStartMs !== null ? tx(m.queue_estimated_start, { time: est }) : m.queue_no_estimate;

  const verbs = (
    <span className={`flex flex-shrink-0 items-center gap-0.5 ${compact ? 'ae-reveal' : ''}`}>
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
    </span>
  );

  const gateTag = gated && (
    <span className="inline-flex flex-shrink-0 items-center gap-1 text-status-warning">
      <Clock className="h-3.5 w-3.5" aria-hidden />{tx(m.queue_not_before, { time: gate })}
    </span>
  );

  if (compact) {
    return (
      <div
        tabIndex={0}
        onContextMenu={menu.onContextMenu}
        onKeyDown={menu.onKeyDown}
        aria-label={`${tx(m.queue_rank_aria, { rank })}, ${f.label}, ${eta}`}
        className={`ae-line ae-row ae-focus ae-t-info flex min-w-0 items-center gap-2 py-1.5 pl-1 pr-1.5 ${flash ? 'is-flash' : ''} ${lifted ? 'ae-dragging bg-background' : ''}`}
      >
        {grip}
        <span className="w-6 flex-shrink-0 text-center typo-data tabular-nums text-foreground">{rank}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate typo-body text-foreground">{f.label}</span>
          <span className="flex min-w-0 items-center gap-1.5 typo-caption">
            <Origin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate tabular-nums">{eta}</span>
            {gateTag}
          </span>
        </span>
        {verbs}
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      aria-label={tx(m.queue_rank_aria, { rank })}
      className={`ae-win ae-row ae-focus flex min-w-0 items-stretch gap-2 rounded-input py-2 pl-1 pr-2 ${flash ? 'is-flash' : ''} ${lifted ? 'ae-dragging' : ''}`}
    >
      {grip && <span className="flex items-center">{grip}</span>}
      <span className="flex w-9 flex-shrink-0 items-start justify-center typo-data-lg tabular-nums text-foreground" aria-hidden>{rank}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate typo-body text-foreground">{f.label}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 typo-caption">
          <span className="inline-flex items-center gap-1"><Origin className="h-3.5 w-3.5" aria-hidden />{f.originLabel}</span>
          {f.project && <span className="truncate">{f.project}</span>}
          <span className="tabular-nums text-foreground">{eta}</span>
          {gateTag}
        </span>
        {maxWait > 0 && (
          <span className="relative mt-0.5 block h-1.5 rounded-full bg-foreground/[0.07]" aria-hidden>
            {wait !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-status-info/70" style={{ width: `${Math.max(3, (wait / maxWait) * 100)}%` }} />}
            {gateAt !== null && <span className="absolute -inset-y-1 w-0.5 bg-status-warning" style={{ left: `${Math.min(100, (gateAt / maxWait) * 100)}%` }} />}
          </span>
        )}
      </div>
      {verbs}
    </div>
  );
});

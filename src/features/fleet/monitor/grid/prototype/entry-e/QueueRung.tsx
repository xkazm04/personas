// One rung of the queue ladder. Full (Runway): grip, a big rank numeral, the
// title, a meta line (origin, project, estimated start, not-before gate) and the
// wait drawn as a bar, with the four verbs at the right: a ladder on purpose,
// its own grammar. Compact (Lanes, a peer bay): the 36px line every bay row
// wears (WP11 C, `SessionLine` / `LineParts`): grip, rank, the origin glyph in
// the persona face's frame, the title, the estimated start as the lead token
// and the amber not-before gate after it, the lamp at the right edge. State is
// the session fold (`sessionTail`), so a row the door reports in any other
// state is drawn like that session. The verbs float over the rung's right edge
// on hover or focus instead of reserving their width, so the title keeps the lane.
//
// Device mesh: a LOCAL rung also offers "Move to…" (the paired devices), and
// while a move is in flight or was refused the rung says so on a line of its
// own. A PEER's rung (`peer`) is the same rung whose verbs run on that device;
// it has no local session menu and nothing to move.

import { memo, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Clock, Hourglass, X, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { useSessionMenu } from './SessionMenu';
import { pileOfKey } from './pileSkin';
import { Lamp } from './parts';
import { GlyphFace, LineHead, Tok, TOK_ICON, TOK_TYPE } from './LineParts';
import { lineStyle, sessionLineClass, SESSION_LINE_H } from './SessionLine';
import { sessionTail } from './sessionTailModel';
import { clockText } from './personaTailModel';
import { moveOutcomeKey } from '@/stores/slices/network/meshSlice';
import { MoveToMenu } from './devices/MoveToMenu';
import { MeshOutcomeLine, useMeshOutcome } from './devices/MeshOutcomeLine';

export const QueueRung = memo(function QueueRung({
  item, index, total, maxWait, now, compact, flash, lifted = false, grip, onNudge, onStart, onCancel, peer = false,
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
  /** The rung is on a paired device's queue. */
  peer?: boolean;
}) {
  const { t, tx, language } = useTranslation();
  const m = t.monitor;
  const f = useSessionFacts()(item.session, item);
  const sessionMenu = useSessionMenu(item.session);
  const menu = peer ? { onContextMenu: undefined, onKeyDown: undefined } : sessionMenu;
  const moving = useMeshOutcome(moveOutcomeKey(item.sessionId))?.state === 'pending';
  const moveLine = peer ? null : (
    <MeshOutcomeLine outcomeKey={moveOutcomeKey(item.sessionId)} pendingText={m.mesh_move_pending} />
  );
  const est = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const gate = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });
  const gated = item.notBeforeMs !== null && item.notBeforeMs > now;
  const wait = item.estimatedStartMs !== null ? Math.max(0, item.estimatedStartMs - now) : null;
  const gateAt = gated ? Math.max(0, item.notBeforeMs! - now) : null;
  const Origin = f.OriginIcon;
  const rank = item.rank ?? index + 1;
  const eta = item.estimatedStartMs !== null ? tx(m.queue_estimated_start, { time: est }) : m.queue_no_estimate;

  const verbs = (
    <span className={`flex flex-shrink-0 items-center gap-0.5 ${compact ? 'ae-reveal ae-float' : ''}`}>
      <Tooltip content={m.queue_move_up}>
        <Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onNudge(item.sessionId, -1)} aria-label={m.queue_move_up} data-testid="fleet-queue-up" icon={<ChevronUp className="h-4 w-4" />} />
      </Tooltip>
      <Tooltip content={m.queue_move_down}>
        <Button variant="ghost" size="icon-sm" disabled={index === total - 1} onClick={() => onNudge(item.sessionId, 1)} aria-label={m.queue_move_down} data-testid="fleet-queue-down" icon={<ChevronDown className="h-4 w-4" />} />
      </Tooltip>
      {!peer && <MoveToMenu sessionId={item.sessionId} label={f.label} />}
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
    // The 36px line every bay row wears (`LineParts`): the queued state as the
    // lead token (hourglass + estimated start, in the persona line's clock,
    // `clockText`; the sentence keeps the long form), the not-before gate after it
    // (it leaves first in a narrow lane), the lamp at the right edge. The move
    // outcome takes a second row only while a move is pending or was refused.
    const tail = sessionTail({ state: item.session.state, exitCode: item.session.exitCode, startedAt: f.startedAt, now });
    const sentence = [tx(m.queue_rank_aria, { rank }), f.label, eta, ...(gated ? [tx(m.queue_not_before, { time: gate })] : [])].join(' · ');
    return (
      <Tooltip content={sentence} placement="right" delay={450}>
        <div
          tabIndex={0}
          onContextMenu={menu.onContextMenu}
          onKeyDown={menu.onKeyDown}
          aria-label={`${tx(m.queue_rank_aria, { rank })}, ${f.label}, ${eta}`}
          aria-busy={moving || undefined}
          data-pile={pileOfKey(tail.kind)}
          data-kind={tail.kind}
          className={`${sessionLineClass(tail)} is-inert flex min-w-0 flex-col ${flash ? 'is-flash' : ''} ${lifted ? 'ae-dragging' : ''}`}
          style={{ ...lineStyle(item.sessionId), height: undefined, minHeight: SESSION_LINE_H }}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 pl-1 pr-2.5" style={{ height: SESSION_LINE_H }}>
            {grip}
            <span className="w-4 flex-shrink-0 text-center typo-data tabular-nums text-foreground" aria-hidden>{rank}</span>
            <GlyphFace Icon={Origin} />
            <LineHead
              name={f.label}
              lead={<Tok><Hourglass className={TOK_ICON} aria-hidden />{item.estimatedStartMs !== null ? clockText(item.estimatedStartMs, language, now) : m.queue_no_estimate}</Tok>}
              leadTestId="queue-rung-eta"
              after={gated ? <Tok className={`${TOK_TYPE} ae-sep text-status-warning`}><Clock className={TOK_ICON} aria-hidden />{clockText(item.notBeforeMs!, language, now)}</Tok> : null}
            />
            <span className="ml-auto flex flex-shrink-0 items-center pl-1"><Lamp lamp={tail.lamp} /></span>
          </span>
          {moveLine && <span className="pb-1 pl-12">{moveLine}</span>}
          {verbs}
        </div>
      </Tooltip>
    );
  }

  return (
    <div
      tabIndex={0}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      aria-label={tx(m.queue_rank_aria, { rank })}
      aria-busy={moving || undefined}
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
        {moveLine}
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

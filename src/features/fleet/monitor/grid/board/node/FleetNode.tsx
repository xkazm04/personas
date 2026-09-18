// FleetNode — the one visual every node on the Activity board is painted with.
//
// A persona, a live session and a queued session used to be three tiles with
// three copies of the same 152×38 single-line box, and the line could not hold
// a task title. This is the box they share now: `NODE_W` wide, TWO ROWS —
//
//   • the TITLE ROW, the whole width, one line, `typo-body`. It truncates only
//     as a last resort and the full title is always in the body's tooltip;
//   • a thin META ROW, `typo-caption`, muted, whose content is HANDPICKED per
//     kind and per variant (`nodeVariant.ts`) and deliberately nothing more:
//       running session → state · elapsed · origin · project label
//       queued session  → rank · ETA · origin · gate marker (future not-before)
//       persona         → state · team · unseen chat · queued count
//
// The node is the VISUAL and the shell. Behaviour stays in the thin wrappers
// (`PersonaTile`, `SessionTile`, `QueueTile`): they decide the menus, the
// confirms and the aria text, and hand this component the body's activation,
// its tooltip, and the sibling controls that go before (`leading`: a drag
// handle, a lock) and after (`trailing`: recap, ↑/↓, the ⋯ menu) the body. The
// body is a `<button>` only when it activates something — a control inside a
// control is invalid, and the siblings are siblings for that reason.
//
// What is preserved from the tiles, on purpose: the persona's state RAIL on the
// leading edge (a column still reads as a colour strip), the session's state on
// a dashed (queued) or solid (live) border from the canonical fleet palette,
// the flash ring, the speech bubble over the title row, the operation chip and
// the published `data-testid`s.

import { memo, type MouseEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Hourglass, MessageCircle, PowerOff } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { PersonaCardModel } from '../../../monitorModel';
import { actionBadges, cleanName, squareState, SQUARE_VISUAL } from '../../fleetGridModel';
import { SESSION_BORDER, sessionLabel, sessionStateMeta } from '../../fleetSessionModel';
import { SESSION_TILE_H, TILE_H, NODE_W } from '../../gridGeometry';
import type { ChatBubble } from '../../channelBubbleModel';
import { asOrigin, type QueueItem } from '../queue/useQueueModel';
import { originLabel } from '../queue/originLabel';
import { useNodeContext, type NodeVariant } from './nodeVariant';

// ---------------------------------------------------------------------------
// The meter's arithmetic — pure, so the tests drive it without a DOM.
// ---------------------------------------------------------------------------

/** A live row: how far along its mean it is, capped at full. No mean → empty. */
export function liveMeterFill(elapsedMs: number, meanMs: number | null): number {
  if (meanMs === null || meanMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / meanMs));
}

/**
 * A queued row: rank over the queue length, INVERTED, so the head of the
 * queue is nearly full and the tail nearly empty — "how close to starting".
 */
export function queuedMeterFill(rank: number | null, queueLength: number): number {
  if (rank === null || rank < 1 || queueLength < 1) return 0;
  return Math.max(0, Math.min(1, 1 - rank / (queueLength + 1)));
}

// ---------------------------------------------------------------------------

export interface FleetNodeShellProps {
  width?: number;
  height?: number;
  /** Athena pointed at this node — ring it until the board clears the signal. */
  flash?: boolean;
  selected?: boolean;
  reducedMotion?: boolean;
  /** Controls before the body (a drag handle, a lock) — siblings, never children. */
  leading?: ReactNode;
  /** Controls after the body (recap, ↑/↓, the menu) — siblings, never children. */
  trailing?: ReactNode;
  /** Present → the body is a button that does this. Absent → an inert, labelled body. */
  onActivate?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** The body's accessible name — the full title plus its meta lines. */
  ariaLabel: string;
  /** The body's tooltip — the full title, untruncated, plus the same lines. */
  tooltip: ReactNode;
  /** `data-testid` on the body (the element a test clicks). */
  bodyTestId?: string;
  /** `data-testid` on the shell. */
  testId?: string;
  /** `data-*` attributes on the body. */
  data?: Record<string, string | number | boolean | undefined>;
}

export type FleetNodeProps = FleetNodeShellProps & (
  | {
      kind: 'persona';
      card: PersonaCardModel;
      /** The column's team; `null` in the tray. */
      teamName: string | null;
      /** The persona's latest channel line, while its bubble is up. */
      bubble?: ChatBubble | null;
      /** Channel lines posted since the operator last opened this persona. */
      unseenChat?: number;
      /** Switched off (its own switch or its project's). */
      off?: boolean;
    }
  | {
      kind: 'session';
      session: FleetSession;
      /** The queue's read of the row, when a queue board paints it. */
      queue?: QueueItem | null;
      /** A live row sitting past the cap after a Start now — warning border. */
      overAdmitted?: boolean;
    }
);

/** The meta row's hairline meter with its one stat. */
function Meter({ fill, hue, stat }: { fill: number; hue: string; stat: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" data-testid="fleet-node-meter" data-fill={fill.toFixed(2)}>
      <span aria-hidden className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-secondary/60">
        <span className={`absolute inset-y-0 left-0 rounded-full ${hue}`} style={{ width: `${Math.round(fill * 100)}%` }} />
      </span>
      <span className="flex-shrink-0 tabular-nums">{stat}</span>
    </span>
  );
}

const pill = 'inline-flex h-[14px] flex-shrink-0 items-center gap-0.5 rounded-full px-1 leading-none';
const badge = `${pill} border border-border bg-secondary/40 text-foreground`;

function ChatMark({ count }: { count: number }) {
  return (
    <span aria-hidden data-testid="fleet-grid-chat-unseen" className={`${pill} bg-primary/15 text-primary`}>
      <MessageCircle className="h-[10px] w-[10px] flex-shrink-0" />
      <span className="text-[9px] font-bold tabular-nums">{count > 9 ? '9+' : count}</span>
    </span>
  );
}

/** The persona's meta row, by variant. */
function PersonaMeta({
  variant, card, teamName, unseenChat, stateLabel, hue, meanDurationMs,
}: {
  variant: NodeVariant;
  card: PersonaCardModel;
  teamName: string | null;
  unseenChat: number;
  stateLabel: string;
  hue: string;
  meanDurationMs: number | null;
}) {
  const { t, tx } = useTranslation();
  const queuedCount = card.queued > 0
    ? tx(t.monitor.node_queued_count, { count: card.queued })
    : null;

  if (variant === 'meter') {
    const live = card.runningSince !== null;
    const fill = live ? liveMeterFill(Date.now() - card.runningSince!, meanDurationMs) : 0;
    return (
      <Meter
        fill={fill}
        hue={hue}
        stat={live
          ? <RelativeTime timestamp={card.runningSince} format="elapsed" showTooltip={false} />
          : <span data-testid="fleet-node-state">{stateLabel}</span>}
      />
    );
  }

  if (variant === 'badge') {
    return (
      <>
        <span className={badge} data-testid="fleet-node-state">{stateLabel}</span>
        {unseenChat > 0 && <ChatMark count={unseenChat} />}
        {queuedCount && <span className={badge} data-testid="fleet-node-queued">{queuedCount}</span>}
      </>
    );
  }

  return (
    <>
      <span className="inline-flex flex-shrink-0 items-center gap-1" data-testid="fleet-node-state">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${hue}`} />
        {stateLabel}
      </span>
      {teamName && (
        <>
          <span aria-hidden className="opacity-40">·</span>
          <span className="min-w-0 truncate" data-testid="fleet-node-team">{teamName}</span>
        </>
      )}
      {unseenChat > 0 && <ChatMark count={unseenChat} />}
      {queuedCount && (
        <>
          <span aria-hidden className="opacity-40">·</span>
          <span className="flex-shrink-0 tabular-nums" data-testid="fleet-node-queued">{queuedCount}</span>
        </>
      )}
    </>
  );
}

/** The session's meta row, by variant and by whether the row is queued. */
function SessionMeta({
  variant, session, queue, stateLabel, hue, meanDurationMs, queueLength,
}: {
  variant: NodeVariant;
  session: FleetSession;
  queue: QueueItem | null;
  stateLabel: string;
  hue: string;
  meanDurationMs: number | null;
  queueLength: number;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const queued = session.state === 'queued';
  const rank = queue?.rank ?? null;
  const eta = useFormattedDate(queue?.estimatedStartMs ?? null, { timeStyle: 'short' });
  const hasEta = queue?.estimatedStartMs != null;
  const gated = queue?.notBeforeMs != null && queue.notBeforeMs > Date.now();
  const origin = originLabel(s, asOrigin(queue?.origin ?? session.origin));
  const createdAt = Number(session.createdAtMs);

  const gate = gated && (
    <Hourglass aria-hidden data-testid="fleet-node-gate" className="h-2.5 w-2.5 flex-shrink-0 text-status-warning" />
  );
  const rankText = rank !== null ? tx(s.queue_rank, { rank }) : '·';
  const etaText = hasEta ? eta : s.queue_no_estimate;

  if (variant === 'meter') {
    const fill = queued
      ? queuedMeterFill(rank, queueLength)
      : liveMeterFill(Date.now() - createdAt, meanDurationMs);
    return (
      <>
        <Meter
          fill={fill}
          hue={hue}
          stat={queued
            ? <span data-testid="fleet-node-eta">{etaText}</span>
            : <RelativeTime timestamp={createdAt} format="elapsed" showTooltip={false} />}
        />
        {gate}
      </>
    );
  }

  if (variant === 'badge') {
    return (
      <>
        <span className={badge} data-testid="fleet-node-state">{stateLabel}</span>
        {queued && (
          <span className={`${badge} font-semibold tabular-nums`} data-testid="fleet-queue-rank" aria-label={rank !== null ? tx(s.queue_rank_aria, { rank }) : s.queue_rank_unknown}>
            {rankText}
          </span>
        )}
        {session.projectLabel && (
          <span className={`${badge} min-w-0 max-w-[40%] truncate`} data-testid="fleet-node-project">{session.projectLabel}</span>
        )}
        {gate}
      </>
    );
  }

  if (queued) {
    return (
      <>
        <span
          className="flex-shrink-0 font-semibold tabular-nums"
          data-testid="fleet-queue-rank"
          aria-label={rank !== null ? tx(s.queue_rank_aria, { rank }) : s.queue_rank_unknown}
        >
          {rankText}
        </span>
        <span aria-hidden className="opacity-40">·</span>
        <span className="min-w-0 truncate tabular-nums" data-testid="fleet-node-eta">
          {hasEta ? tx(s.node_eta, { time: eta }) : s.queue_no_estimate}
        </span>
        <span className={`${badge} ml-auto`} data-testid="fleet-queue-origin">{origin}</span>
        {gate}
      </>
    );
  }

  return (
    <>
      <span className="inline-flex flex-shrink-0 items-center gap-1" data-testid="fleet-node-state">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${hue}`} />
        {stateLabel}
      </span>
      <span aria-hidden className="opacity-40">·</span>
      <RelativeTime timestamp={createdAt} format="elapsed" showTooltip={false} className="flex-shrink-0 tabular-nums" />
      <span className={badge} data-testid="fleet-queue-origin">{origin}</span>
      {session.projectLabel && (
        <span className="min-w-0 truncate" data-testid="fleet-node-project">{session.projectLabel}</span>
      )}
    </>
  );
}

export const FleetNode = memo(function FleetNode(props: FleetNodeProps) {
  const {
    width = NODE_W, flash = false, selected = false, reducedMotion = false,
    leading, trailing, onActivate, onContextMenu, ariaLabel, tooltip, bodyTestId, testId, data,
  } = props;
  const height = props.height ?? (props.kind === 'persona' ? TILE_H : SESSION_TILE_H);
  const { t } = useTranslation();
  const { variant, meanDurationMs, queueLength } = useNodeContext();

  // The two kinds decide their own title, hue, frame and meta row; everything
  // below the `shell` line is shared.
  let title: string;
  let hue: string;
  let frame: string;
  let titleTone: string;
  let glyph: ReactNode = null;
  let titleChips: ReactNode = null;
  let meta: ReactNode;
  let bubble: ChatBubble | null = null;
  let bubbleBorder: string | undefined;

  if (props.kind === 'persona') {
    const { card, teamName, unseenChat = 0, off = false } = props;
    const st = squareState(card);
    const v = SQUARE_VISUAL[st];
    const stateLabel = {
      running: t.monitor.grid_state_running,
      attention: t.monitor.grid_state_attention,
      failed: t.monitor.grid_state_failed,
      idle: t.monitor.grid_state_idle,
    }[st];
    const dominant = actionBadges(card)[0] ?? null;
    const Badge = dominant?.icon;
    title = cleanName(card.personaName);
    hue = v.accent;
    frame = `border ${selected ? 'border-primary/50 bg-primary/10' : 'border-border bg-foreground/[0.02] hover:border-primary/30 hover:bg-secondary/40'}`;
    titleTone = off ? 'text-foreground opacity-45' : st === 'idle' ? 'text-foreground/60' : 'text-foreground';
    bubble = props.bubble ?? null;
    bubbleBorder = card.personaColor ?? undefined;
    glyph = (
      <>
        {off && <PowerOff aria-hidden data-testid="fleet-grid-disabled" className="h-3 w-3 flex-shrink-0 text-foreground opacity-50" />}
        {variant === 'badge' && !off && (
          <span aria-hidden className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${v.accent} ${v.pulse ? 'animate-pulse' : ''}`} />
        )}
      </>
    );
    titleChips = (
      <>
        {/* The meter row has room for one stat only, so the chat mark keeps
            its old seat in the title row there. */}
        {variant === 'meter' && unseenChat > 0 && <ChatMark count={unseenChat} />}
        {dominant && Badge && (
          <span
            aria-hidden
            data-testid="fleet-grid-badge"
            className={`inline-flex h-[15px] min-w-[15px] flex-shrink-0 items-center justify-center gap-px rounded-full px-[3px] leading-none ${dominant.tone}`}
          >
            <Badge className="h-[10px] w-[10px] flex-shrink-0" />
            {dominant.count > 0 && (
              <span className="text-[9px] font-bold tabular-nums">{dominant.count > 9 ? '9+' : dominant.count}</span>
            )}
          </span>
        )}
      </>
    );
    meta = (
      <PersonaMeta
        variant={variant}
        card={card}
        teamName={teamName}
        unseenChat={unseenChat}
        stateLabel={stateLabel}
        hue={v.accent}
        meanDurationMs={meanDurationMs}
      />
    );
  } else {
    const { session, queue = null, overAdmitted = false } = props;
    const m = sessionStateMeta(session.state);
    const queued = session.state === 'queued';
    title = sessionLabel(session);
    hue = m.dot;
    const border = overAdmitted ? 'border-status-warning' : SESSION_BORDER[session.state];
    frame = `border-[1.5px] ${queued ? 'border-dashed bg-foreground/[0.015]' : 'border-solid'} ${border} ${m.chip} ${
      selected ? 'ring-1 ring-primary/40' : ''
    }`;
    titleTone = m.text;
    if (variant === 'badge') {
      glyph = <span aria-hidden className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${m.dot}`} />;
    }
    meta = (
      <SessionMeta
        variant={variant}
        session={session}
        queue={queue}
        stateLabel={t.plugins.fleet[m.labelKey]}
        hue={m.dot}
        meanDurationMs={meanDurationMs}
        queueLength={queueLength}
      />
    );
  }

  const shell = `group relative flex flex-shrink-0 items-center gap-0.5 overflow-hidden rounded-input pl-1 pr-0.5 transition-colors ${frame} ${
    flash ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
  }`;

  const rows = (
    <>
      <span className="flex min-w-0 items-center gap-1">
        {glyph}
        <span className={`min-w-0 flex-1 truncate typo-body ${titleTone}`} data-testid="fleet-node-title">{title}</span>
        {titleChips}
      </span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap typo-caption text-foreground opacity-70" data-testid="fleet-node-meta">
        {meta}
      </span>
      {/* The speech bubble: slides up over the title row, fades out on its
          own. Keyed on the message id so a newer line from the same persona
          plays its own entrance instead of mutating the old bubble in place. */}
      <AnimatePresence>
        {bubble && (
          <motion.span
            key={bubble.id}
            aria-hidden
            data-testid="fleet-grid-chat-bubble"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: 'easeOut', opacity: { duration: 0.45 } }}
            className="absolute inset-x-1 top-1 flex h-5 items-center gap-1 rounded-full border border-primary/30 bg-background/95 px-2 shadow-elevation-1"
            style={{ borderColor: bubbleBorder }}
          >
            <MessageCircle className="h-[11px] w-[11px] flex-shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate typo-caption text-foreground">{bubble.text}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );

  const bodyClass = 'relative flex h-full min-w-0 flex-1 flex-col justify-center gap-px px-1 text-left';
  const dataAttrs = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v === undefined ? undefined : String(v)]),
  );

  // The shared Tooltip, not `title=`: the body is interactive on most boards,
  // and a native tooltip on a control is unreachable by keyboard and absent
  // on touch (the tooltip golden path). The inert body gets the same one.
  const body = onActivate ? (
    <Tooltip content={tooltip}>
      <button
        type="button"
        onClick={onActivate}
        onContextMenu={onContextMenu}
        aria-label={ariaLabel}
        aria-pressed={props.kind === 'persona' ? selected : undefined}
        data-testid={bodyTestId}
        {...dataAttrs}
        className={`${bodyClass} focus-ring rounded-interactive transition-[filter] hover:brightness-110`}
      >
        {rows}
      </button>
    </Tooltip>
  ) : (
    <Tooltip content={tooltip}>
      <span role="img" aria-label={ariaLabel} data-testid={bodyTestId} {...dataAttrs} className={bodyClass}>
        {rows}
      </span>
    </Tooltip>
  );

  return (
    <div className={shell} style={{ width, height }} data-testid={testId} data-kind={props.kind} data-variant={variant}>
      {/* The persona's state rail — the whole leading edge, so a column reads
          as a colour strip you can scan without reading a word. Sessions say
          their state on the border instead: two kinds, two shapes. */}
      {props.kind === 'persona' && (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1 ${hue} ${SQUARE_VISUAL[squareState(props.card)].pulse ? 'animate-pulse' : ''}`}
        />
      )}
      {leading}
      {body}
      {trailing}
    </div>
  );
});

export default FleetNode;

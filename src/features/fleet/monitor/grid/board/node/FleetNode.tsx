// FleetNode — the one visual every node on the Activity board is painted with.
//
// `NODE_W` wide, TWO ROWS, and the rows are strict about what they hold:
//
//   • the TITLE ROW is the title and NOTHING ELSE — the whole width, one
//     line, `typo-body`, no glyph, no chip, no control beside it. It truncates
//     only past ~24 characters, and the full title is always in the row's
//     tooltip. (The first two-row node still shared this row with a glyph and
//     a chip, and handed the shell `leading` / `trailing` columns that sat
//     beside the body for its full height; at 172 px the title was left about
//     100. Rejected 2026-09-18; this is the fix.)
//   • the SYMBOL ROW is symbols and NOTHING ELSE — an 18 px strip of
//     icon-sized indicators, each a lucide glyph or a pure-CSS mark with an
//     `aria-label` and a `Tooltip`, never a word. The map — which symbols, in
//     which order, in which hue — is `nodeSymbols.ts`, so every board agrees.
//
// The node is the VISUAL and the shell. Behaviour stays in the thin wrappers
// (`PersonaTile`, `SessionTile`, `QueueTile`): they decide the menus, the
// confirms and the aria text, and hand this component the body's activation,
// its tooltip, and the AFFORDANCES (`symbols`: a drag grip, a lock, recap,
// ↑/↓, cancel, start now, the ⋯ menu) that ride the symbol row's right end and
// appear on hover or focus-within. Those are SIBLINGS of the body, never its
// children: the body is a `<button>` when it activates something, and a
// control inside a control is invalid.
//
// The three styles (`nodeVariant.ts`) differ in frame, hue application and
// symbol treatment — `NODE_STYLE` is the whole difference — never in which
// symbols show.

import { Fragment, memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Layers, MessageCircle, PowerOff, Timer } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { formatElapsedCompact } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { PersonaCardModel } from '../../../monitorModel';
import { actionBadges, cleanName, squareState } from '../../fleetGridModel';
import { sessionLabel, sessionStateMeta } from '../../fleetSessionModel';
import { SESSION_TILE_H, TILE_H, NODE_W } from '../../gridGeometry';
import type { ChatBubble } from '../../channelBubbleModel';
import { asOrigin, type QueueItem } from '../queue/useQueueModel';
import { originLabel } from '../queue/originLabel';
import { useNodeContext } from './nodeVariant';
import {
  frameClass, NODE_STYLE, ORIGIN_GLYPH, PERSONA_STATE_MARK, personaHue, personaSymbols, SESSION_STATE_MARK, sessionHue,
  sessionSymbols, swatchHue, swatchInitial, symbolClass, WARNING_HUE,
  type NodeHue, type NodeStyle, type NodeSymbolId, type StateMark,
} from './nodeSymbols';

// ---------------------------------------------------------------------------
// The elapsed fill's arithmetic — pure, so the tests drive it without a DOM.
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
  /** Forces the reduced-motion posture; otherwise read from the OS preference. */
  reducedMotion?: boolean;
  /**
   * The wrapper's affordances — buttons (a drag grip, a lock, recap, ↑/↓,
   * cancel, start now, the ⋯ menu). They ride the symbol row's right end,
   * revealed on hover / focus-within, as SIBLINGS of the body.
   */
  symbols?: ReactNode;
  /** Present → the body is a button that does this. Absent → an inert, labelled body. */
  onActivate?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** The body's accessible name — the full title plus its meta lines. */
  ariaLabel: string;
  /** The title row's tooltip — the full title, untruncated, plus the same lines. */
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
      /** A live row sitting past the cap after a Start now — warning frame. */
      overAdmitted?: boolean;
    }
);

// ---------------------------------------------------------------------------
// The symbols.
// ---------------------------------------------------------------------------

/**
 * One AFFORDANCE button, for the wrappers: 16 px to match a symbol, revealed
 * with the cluster, full on its own hover / focus. Owned here so every board's
 * affordances are dressed alike.
 */
export const AFFORDANCE_BTN = 'focus-ring flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:opacity-25';

const SYMBOL_BOX = 'inline-flex h-4 w-4 flex-shrink-0 items-center justify-center';
const GLYPH = 'h-2.5 w-2.5 flex-shrink-0';
const NUMERAL = 'text-[9px] font-bold leading-none tabular-nums';

/** One symbol: an inert labelled box with its tooltip. */
function Sym({
  id, label, tooltip, className, testId, data, children,
}: {
  id: NodeSymbolId;
  label: string;
  tooltip?: ReactNode;
  className: string;
  testId?: string;
  data?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip ?? label}>
      <span role="img" aria-label={label} data-symbol={id} data-testid={testId} {...data} className={`${SYMBOL_BOX} ${className}`}>
        {children}
      </span>
    </Tooltip>
  );
}

/** The state's mark, painted with `currentColor` so the box's class decides its hue. */
function StateGlyph({ mark, reducedMotion }: { mark: StateMark; reducedMotion: boolean }) {
  switch (mark.kind) {
    case 'pulse':
      return <span aria-hidden className={`h-2 w-2 rounded-full bg-current ${reducedMotion ? '' : 'animate-pulse'}`} />;
    case 'hollow':
      return <span aria-hidden className="h-2 w-2 rounded-full border-[1.5px] border-current" />;
    case 'icon': {
      const Icon = mark.icon;
      return <Icon aria-hidden className={GLYPH} />;
    }
  }
}

/**
 * A 12 px ring, filled clockwise to `fill`, drawn with `currentColor`: a solid
 * disc masked by a conic sector ∩ a radial hole. No text.
 */
function ElapsedRing({ fill }: { fill: number }) {
  const pct = Math.round(fill * 100);
  const mask = `conic-gradient(#000 ${pct}%, transparent 0), radial-gradient(circle, transparent 3px, #000 3.5px)`;
  const style: CSSProperties = {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  };
  return (
    <span aria-hidden className="relative inline-flex h-3 w-3 flex-shrink-0">
      <span className="absolute inset-0 rounded-full border border-current opacity-30" />
      <span className="absolute inset-0 rounded-full bg-current" style={style} />
    </span>
  );
}

/** A 12 px coloured square with the initial letter, hue hashed from the name. */
function Swatch({ name, inverse }: { name: string; inverse: boolean }) {
  // `--swatch-h` is the ONE value that varies; the classes derive every colour
  // from it, with a darker letter under a light theme.
  const style = { '--swatch-h': swatchHue(name) } as CSSProperties;
  const tone = inverse
    ? 'bg-[hsl(var(--swatch-h)_55%_48%)] text-background'
    : 'border border-[hsl(var(--swatch-h)_60%_50%/0.7)] bg-[hsl(var(--swatch-h)_60%_50%/0.22)] text-[hsl(var(--swatch-h)_70%_62%)] [[data-theme^=light]_&]:text-[hsl(var(--swatch-h)_70%_32%)]';
  return (
    <span aria-hidden style={style} className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-none ${NUMERAL} ${tone}`}>
      {swatchInitial(name)}
    </span>
  );
}

/** The unseen-chat count — the one numeral-in-a-dot the row allows. */
function ChatMark({ count }: { count: number }) {
  return (
    <>
      <MessageCircle aria-hidden className={GLYPH} />
      <span aria-hidden className={`${NUMERAL} -ml-px`}>{count > 9 ? '9+' : count}</span>
    </>
  );
}

// ---------------------------------------------------------------------------

export const FleetNode = memo(function FleetNode(props: FleetNodeProps) {
  const {
    width = NODE_W, flash = false, selected = false,
    symbols, onActivate, onContextMenu, ariaLabel, tooltip, bodyTestId, testId, data,
  } = props;
  const height = props.height ?? (props.kind === 'persona' ? TILE_H : SESSION_TILE_H);
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const { variant: style, meanDurationMs, queueLength } = useNodeContext();
  const reducedMotion = (useReducedMotion() ?? false) || (props.reducedMotion ?? false);
  const spec = NODE_STYLE[style];

  // Hooks first — the ETA is a date the queued row's tooltip names.
  const queue = props.kind === 'session' ? props.queue ?? null : null;
  const eta = useFormattedDate(queue?.estimatedStartMs ?? null, { timeStyle: 'short' });
  const notBefore = useFormattedDate(queue?.notBeforeMs ?? null, { timeStyle: 'short' });

  // The two kinds decide their own title, hue, frame and symbol list;
  // everything below the `shell` line is shared.
  let title: string;
  let hue: NodeHue;
  let frame: string;
  let titleTone: string;
  let ids: NodeSymbolId[];
  let bubble: ChatBubble | null = null;
  let bubbleBorder: string | undefined;
  let elapsedFill = 0;
  const renderers: Partial<Record<NodeSymbolId, () => ReactNode>> = {};

  if (props.kind === 'persona') {
    const { card, teamName, unseenChat = 0, off = false } = props;
    const st = squareState(card);
    hue = personaHue(st);
    const stateLabel = {
      running: s.grid_state_running,
      attention: s.grid_state_attention,
      failed: s.grid_state_failed,
      idle: s.grid_state_idle,
    }[st];
    const dominant = actionBadges(card)[0] ?? null;
    title = cleanName(card.personaName);
    frame = frameClass(style, hue);
    titleTone = off ? 'opacity-45' : st === 'idle' ? 'opacity-60' : '';
    bubble = props.bubble ?? null;
    bubbleBorder = card.personaColor ?? undefined;
    ids = personaSymbols({ off, teamName, unseenChat, queued: card.queued, operation: dominant !== null });

    renderers.state = () => (
      <Sym id="state" label={stateLabel} testId="fleet-node-state" data={{ 'data-state': st }} className={symbolClass(style, hue, true)}>
        <StateGlyph mark={PERSONA_STATE_MARK[st]} reducedMotion={reducedMotion} />
      </Sym>
    );
    renderers.off = () => (
      <Sym id="off" label={s.grid_persona_disabled} testId="fleet-grid-disabled" className={symbolClass(style, hue, false)}>
        <PowerOff aria-hidden className={GLYPH} />
      </Sym>
    );
    renderers.team = () => (
      <Sym id="team" label={tx(s.node_symbol_team, { name: teamName ?? '' })} testId="fleet-node-team" className="">
        <Swatch name={teamName ?? ''} inverse={spec.symbolTone === 'inverse'} />
      </Sym>
    );
    renderers.operation = () => {
      const Icon = dominant!.icon;
      const line = {
        failed: s.grid_badge_failed,
        review: tx(s.grid_badge_review, { count: dominant!.count }),
        input: tx(s.grid_badge_input, { count: dominant!.count }),
        draft: tx(s.grid_badge_draft, { count: dominant!.count }),
        message: tx(s.grid_badge_message, { count: dominant!.count }),
      }[dominant!.key];
      return (
        <Sym id="operation" label={line} testId="fleet-grid-badge" data={{ 'data-action': dominant!.key }} className={symbolClass(style, hue, false)}>
          <Icon aria-hidden className={GLYPH} />
        </Sym>
      );
    };
    renderers.unseen = () => (
      <Sym id="unseen" label={tx(s.grid_chat_unseen, { count: unseenChat })} testId="fleet-grid-chat-unseen" data={{ 'data-count': String(unseenChat) }} className={`${symbolClass(style, hue, false)} w-auto gap-px px-0.5`}>
        <ChatMark count={unseenChat} />
      </Sym>
    );
    renderers.queued = () => (
      <Sym id="queued" label={tx(s.node_queued_count, { count: card.queued })} testId="fleet-node-queued" data={{ 'data-count': String(card.queued) }} className={`${symbolClass(style, hue, false)} w-auto gap-px px-0.5`}>
        <Layers aria-hidden className={GLYPH} />
        <span aria-hidden className={NUMERAL}>{card.queued > 9 ? '9+' : card.queued}</span>
      </Sym>
    );
  } else {
    const { session, overAdmitted = false } = props;
    const m = sessionStateMeta(session.state);
    const queued = session.state === 'queued';
    const rank = queue?.rank ?? null;
    const gated = queue?.notBeforeMs != null && queue.notBeforeMs > Date.now();
    const origin = asOrigin(queue?.origin ?? session.origin);
    const createdAt = Number(session.createdAtMs);
    const stateLabel = t.plugins.fleet[m.labelKey];
    const hasFill = queued ? rank !== null && queueLength > 0 : session.state === 'running' && meanDurationMs !== null;
    elapsedFill = !hasFill ? 0 : queued ? queuedMeterFill(rank, queueLength) : liveMeterFill(Date.now() - createdAt, meanDurationMs);

    title = sessionLabel(session);
    hue = overAdmitted ? WARNING_HUE : sessionHue(session.state);
    frame = frameClass(style, hue, { queued });
    titleTone = '';
    ids = sessionSymbols({
      state: session.state, elapsedFill: hasFill ? elapsedFill : null, rank, gated, projectLabel: session.projectLabel ?? null,
    });

    const OriginIcon = ORIGIN_GLYPH[origin];
    const elapsedLabel = queued
      ? (queue?.estimatedStartMs != null ? tx(s.queue_estimated_start, { time: eta }) : s.queue_no_estimate)
      : tx(s.node_symbol_elapsed, { time: formatElapsedCompact(new Date(createdAt).toISOString(), '-') });

    renderers.state = () => (
      <Sym id="state" label={overAdmitted ? `${stateLabel} · ${s.queue_over_admitted}` : stateLabel} testId="fleet-node-state" data={{ 'data-state': session.state }} className={symbolClass(style, hue, true)}>
        <StateGlyph mark={SESSION_STATE_MARK[session.state]} reducedMotion={reducedMotion} />
      </Sym>
    );
    renderers.origin = () => (
      <Sym id="origin" label={tx(s.node_symbol_origin, { origin: originLabel(s, origin) })} testId="fleet-queue-origin" data={{ 'data-origin': origin }} className={symbolClass(style, hue, false)}>
        <OriginIcon aria-hidden className={GLYPH} />
      </Sym>
    );
    renderers.rank = () => (
      <Sym id="rank" label={tx(s.queue_rank_aria, { rank: rank! })} testId="fleet-queue-rank" data={{ 'data-rank': String(rank) }} className={`${symbolClass(style, hue, false)} ${spec.chip ? '' : 'rounded-full border border-current'}`}>
        <span aria-hidden className={NUMERAL}>{rank! > 99 ? '99+' : rank}</span>
      </Sym>
    );
    renderers.gate = () => (
      <Sym id="gate" label={tx(s.queue_not_before, { time: notBefore })} testId="fleet-node-gate" className={symbolClass(style, hue, false)}>
        <Timer aria-hidden className={GLYPH} />
      </Sym>
    );
    renderers.elapsed = () => (
      <Sym id="elapsed" label={elapsedLabel} testId="fleet-node-elapsed" data={{ 'data-fill': elapsedFill.toFixed(2) }} className={symbolClass(style, hue, false)}>
        <ElapsedRing fill={elapsedFill} />
      </Sym>
    );
    renderers.project = () => (
      <Sym id="project" label={tx(s.node_symbol_project, { name: session.projectLabel ?? '' })} testId="fleet-node-project" className="">
        <Swatch name={session.projectLabel ?? ''} inverse={spec.symbolTone === 'inverse'} />
      </Sym>
    );
  }

  // The tinted style draws the elapsed fill as a bar along the bottom edge,
  // across the full node width, instead of a ring in the row.
  const barElapsed = spec.elapsed === 'bar' && ids.includes('elapsed');
  const rowIds = barElapsed ? ids.filter((id) => id !== 'elapsed') : ids;

  const shell = `group relative flex flex-shrink-0 overflow-hidden rounded-input transition-colors ${frame} ${
    selected ? 'ring-1 ring-primary/40' : ''
  } ${flash ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`;

  const rows = (
    <>
      {/* The title row: the title, and nothing else. The shared Tooltip, not
          `title=`, sits on this inert row rather than on the body button, so
          hovering a symbol below shows that symbol's tip alone. */}
      <span className="block h-5 min-w-0" data-testid="fleet-node-title-row">
        <Tooltip content={tooltip}>
          <span className={`block truncate typo-body leading-5 text-foreground ${spec.title} ${titleTone}`} data-testid="fleet-node-title">{title}</span>
        </Tooltip>
      </span>
      <span className="flex h-[18px] min-w-0 items-center gap-1" data-testid="fleet-node-symbols">
        {rowIds.map((id) => <Fragment key={id}>{renderers[id]?.()}</Fragment>)}
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

  const bodyClass = 'relative flex h-full w-full min-w-0 flex-col justify-center px-1 text-left';
  const dataAttrs = Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v === undefined ? undefined : String(v)]),
  );

  const body = onActivate ? (
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
  ) : (
    <span role="img" aria-label={ariaLabel} data-testid={bodyTestId} {...dataAttrs} className={bodyClass}>
      {rows}
    </span>
  );

  return (
    <div className={shell} style={{ width, height }} data-testid={testId} data-kind={props.kind} data-style={style satisfies NodeStyle}>
      {body}
      {barElapsed && (
        <span
          aria-hidden
          data-symbol="elapsed"
          data-testid="fleet-node-elapsed-bar"
          data-fill={elapsedFill.toFixed(2)}
          className={`absolute bottom-0 left-0 h-0.5 ${hue.dot}`}
          style={{ width: `${Math.round(elapsedFill * 100)}%` }}
        />
      )}
      {/* The affordances: siblings of the body, over the symbol row's right
          end, revealed on hover or when anything inside the node has focus
          (a tap on the body focuses within, so touch reaches them too). */}
      {symbols && (
        <span
          data-testid="fleet-node-affordances"
          className="absolute bottom-[3px] right-1 z-10 flex h-4 items-center gap-0.5 rounded-full bg-background/90 px-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
        >
          {symbols}
        </span>
      )}
    </div>
  );
});

export default FleetNode;

// nodeTypes — FleetNode's props, the view each node kind resolves to, and the
// elapsed fill's arithmetic. No React here beyond types: the fills are pure so
// the tests drive them without a DOM.

import type { MouseEvent, ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../monitorModel';
import type { ChatBubble } from '../../channelBubbleModel';
import type { QueueItem } from '../queue/useQueueModel';
import type { NodeHue, NodeSymbolId } from './nodeSymbols';

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
  /**
   * Span the parent's width instead of the fixed `width` — the Lanes board's
   * nodes fill their lane. The height stays fixed either way.
   */
  fill?: boolean;
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

export interface PersonaNodeProps {
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

export interface SessionNodeProps {
  kind: 'session';
  session: FleetSession;
  /** The queue's read of the row, when a queue board paints it. */
  queue?: QueueItem | null;
  /** A live row sitting past the cap after a Start now — warning frame. */
  overAdmitted?: boolean;
  /**
   * The paired device that sent this session here (`originPeerId`, resolved to
   * its display name). The origin symbol then reads "From <device>" instead of
   * the generic origin word — the node's "from" chip, in its own vocabulary.
   */
  originDevice?: string | null;
}

export type FleetNodeProps = FleetNodeShellProps & (PersonaNodeProps | SessionNodeProps);

/**
 * What one node kind resolves to — title, hue, frame, the ordered symbol ids
 * and a renderer per symbol. Everything the shell paints that differs by kind.
 */
export interface NodeView {
  title: string;
  hue: NodeHue;
  frame: string;
  titleTone: string;
  ids: NodeSymbolId[];
  bubble: ChatBubble | null;
  bubbleBorder?: string;
  elapsedFill: number;
  /** What the bar says on hover / to a screen reader: elapsed for a live row, the ETA for a queued one. */
  elapsedLabel: string;
  renderers: Partial<Record<NodeSymbolId, () => ReactNode>>;
}

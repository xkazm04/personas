// nodeSymbols — the node's SECOND ROW, as data: which symbols a node shows, in
// which order, in which hue, and how the node dresses them.
//
// The title row is the title and nothing else (the whole 172 px), so everything
// that used to flank it — the state, who asked for it, the rank, the gate, the
// elapsed fill, the team or project, the unseen chat, the queued count, the
// pending operation — lives here as an ICON-SIZED SYMBOL: a lucide glyph or a
// pure-CSS mark, each with an `aria-label` and a `Tooltip`, never a word.
// The two numerals allowed are a queue RANK (in a ring) and an unseen-chat
// COUNT (in a dot).
//
// ONE ordered list (`NODE_SYMBOL_ORDER`) decides the left → right order on
// every board, so Classic, Runway and Lanes cannot disagree; the two pure
// `*Symbols()` functions decide WHICH of them a given node shows, and the
// tests drive them without a DOM.
//
// The node has ONE treatment (tinted — the winner of a three-way prototype):
// `frameClass` and `symbolClass` (in `nodeHues.ts`, re-exported here) are the whole of it.
//
// Hues come from the canonical fleet palette (`fleetStateMeta` through
// `fleetSessionModel`) and the persona palette (`SQUARE_VISUAL`), never a raw
// colour. Tailwind cannot generate an assembled class, so the 8 % tint and the
// per-state border twins are literal tables, tied to the canonical `dot` by a
// lockstep test (`nodeSymbols.test.ts`).

import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Bot, Check, CircleDashed, Clock, Hand, Hourglass, Laptop, Library, Lightbulb, MessageSquare, Moon,
  Play, RotateCcw, Rss, Sparkles, Square,
} from 'lucide-react';
import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { SquareState } from '../../fleetGridModel';

// ---------------------------------------------------------------------------
// The symbols, in the one order every board paints them.
// ---------------------------------------------------------------------------

export type NodeSymbolId =
  | 'state' | 'off' | 'origin' | 'rank' | 'gate' | 'elapsed' | 'team' | 'project' | 'operation' | 'unseen' | 'queued';

/** Left → right. The state leads, identity (team / project) sits in the middle, counts trail. */
export const NODE_SYMBOL_ORDER: readonly NodeSymbolId[] = [
  'state', 'off', 'origin', 'rank', 'gate', 'elapsed', 'team', 'project', 'operation', 'unseen', 'queued',
];

/** Keep `ids` in the canonical order, whatever order they were collected in. */
function ordered(ids: ReadonlySet<NodeSymbolId>): NodeSymbolId[] {
  return NODE_SYMBOL_ORDER.filter((id) => ids.has(id));
}

export interface SessionSymbolInput {
  state: FleetSessionState;
  /** `null` when the fill has no denominator (no mean yet / no rank yet) — no ring. */
  elapsedFill: number | null;
  rank: number | null;
  /** `notBeforeMs` is still ahead of now. */
  gated: boolean;
  projectLabel: string | null;
}

/**
 * A session node: state · origin · rank (queued only) · gate · elapsed
 * (running or queued, when it has a denominator) · project.
 *
 * The origin ALWAYS shows: a row with no recorded origin reads as a manual
 * dispatch (`asOrigin`), and "the operator started this" is information.
 */
export function sessionSymbols(i: SessionSymbolInput): NodeSymbolId[] {
  const ids = new Set<NodeSymbolId>(['state', 'origin']);
  const queued = i.state === 'queued';
  if (queued && i.rank !== null) ids.add('rank');
  if (queued && i.gated) ids.add('gate');
  if ((queued || i.state === 'running') && i.elapsedFill !== null) ids.add('elapsed');
  if (i.projectLabel) ids.add('project');
  return ordered(ids);
}

export interface PersonaSymbolInput {
  /** Switched off (its own switch or its project's). */
  off: boolean;
  teamName: string | null;
  unseenChat: number;
  queued: number;
  /** A pending operation (`actionBadges(card)[0]`) is waiting on the operator. */
  operation: boolean;
}

/** A persona node: state · off · team · operation · unseen chat · queued count. */
export function personaSymbols(i: PersonaSymbolInput): NodeSymbolId[] {
  const ids = new Set<NodeSymbolId>(['state']);
  if (i.off) ids.add('off');
  if (i.teamName) ids.add('team');
  if (i.operation) ids.add('operation');
  if (i.unseenChat > 0) ids.add('unseen');
  if (i.queued > 0) ids.add('queued');
  return ordered(ids);
}

// ---------------------------------------------------------------------------
// The state symbol — one mark per lifecycle state, per kind.
// ---------------------------------------------------------------------------

export type StateMark =
  /** A dot in the hue, pulsing while motion is allowed. */
  | { kind: 'pulse' }
  /** A hollow dot — present, doing nothing. */
  | { kind: 'hollow' }
  | { kind: 'icon'; icon: LucideIcon };

export const SESSION_STATE_MARK: Record<FleetSessionState, StateMark> = {
  running: { kind: 'pulse' },
  awaiting_input: { kind: 'icon', icon: MessageSquare },
  idle: { kind: 'hollow' },
  stale: { kind: 'icon', icon: Clock },
  queued: { kind: 'icon', icon: Hourglass },
  spawning: { kind: 'icon', icon: CircleDashed },
  finished: { kind: 'icon', icon: Check },
  hibernated: { kind: 'icon', icon: Moon },
  exited: { kind: 'icon', icon: Square },
};

export const PERSONA_STATE_MARK: Record<SquareState, StateMark> = {
  running: { kind: 'pulse' },
  idle: { kind: 'hollow' },
  attention: { kind: 'icon', icon: AlertTriangle },
  failed: { kind: 'icon', icon: AlertTriangle },
};

/**
 * Who asked for the session. `night_shift`'s moon is told from `hibernated`'s by hue: an origin never wears the state hue.
 *
 * This is the FOURTH hand-kept mirror of `DispatchOrigin`, after the Rust enum's
 * `token`/`parse` pair, `ORIGINS` in `useQueueModel` and the switch in `originLabel` —
 * and the only one that fails loudly: an exhaustive `Record` is a tsc error when a
 * variant is added without a glyph, where the other two silently answer `manual`.
 * Keep it exhaustive; a lookup miss here renders `undefined` as a component and
 * throws inside `NodeRows`, which is how the gap was found.
 */
export const ORIGIN_GLYPH: Record<DispatchOrigin, LucideIcon> = {
  manual: Hand,
  dev_runner: Play,
  dispatch_ideas: Lightbulb,
  athena: Sparkles,
  autopilot: Bot,
  night_shift: Moon,
  feed_impact: Rss,
  orphan_resume: RotateCcw,
  // A paired device dispatched this session here.
  remote: Laptop,
  // Curator, draining the operator's request lane or acting on her plan.
  curator: Library,
};

// The colour half — hues, swatch, the one treatment — lives in `nodeHues`;
// re-exported so every existing importer keeps one door.
export * from './nodeHues';

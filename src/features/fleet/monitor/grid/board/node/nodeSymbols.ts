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
// `frameClass` and `symbolClass` at the bottom of this file are the whole of it.
//
// Hues come from the canonical fleet palette (`fleetStateMeta` through
// `fleetSessionModel`) and the persona palette (`SQUARE_VISUAL`), never a raw
// colour. Tailwind cannot generate an assembled class, so the 8 % tint and the
// per-state border twins are literal tables, tied to the canonical `dot` by a
// lockstep test (`nodeSymbols.test.ts`).

import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Bot, Check, CircleDashed, Clock, Hand, Hourglass, Lightbulb, MessageSquare, Moon, Play,
  RotateCcw, Rss, Sparkles, Square,
} from 'lucide-react';
import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { SQUARE_VISUAL, type SquareState } from '../../fleetGridModel';
import { sessionStateMeta } from '../../fleetSessionModel';

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

/** Who asked for the session. `night_shift`'s moon is told from `hibernated`'s by hue: an origin never wears the state hue. */
export const ORIGIN_GLYPH: Record<DispatchOrigin, LucideIcon> = {
  manual: Hand,
  dev_runner: Play,
  dispatch_ideas: Lightbulb,
  athena: Sparkles,
  autopilot: Bot,
  night_shift: Moon,
  feed_impact: Rss,
  orphan_resume: RotateCcw,
};

// ---------------------------------------------------------------------------
// Hue — the two class slots a state paints with.
// ---------------------------------------------------------------------------

export interface NodeHue {
  /** Solid fill: the symbol circles and the elapsed bar. */
  dot: string;
  /** 8 % wash for the node's body. */
  tint: string;
}

/**
 * 8 % washes, twins of `FLEET_STATE_META[].dot` — same hue family, the `500`
 * shade the palette's own `chip` uses. Literal because Tailwind's scanner must
 * see the class verbatim; the lockstep test keeps them honest.
 */
export const SESSION_TINT: Record<FleetSessionState, string> = {
  awaiting_input: 'bg-violet-500/[0.08]',
  running: 'bg-blue-500/[0.08]',
  queued: 'bg-slate-500/[0.08]',
  spawning: 'bg-cyan-500/[0.08]',
  idle: 'bg-emerald-500/[0.08]',
  stale: 'bg-orange-500/[0.08]',
  finished: 'bg-teal-500/[0.08]',
  hibernated: 'bg-indigo-500/[0.08]',
  exited: 'bg-zinc-500/[0.08]',
};

export function sessionHue(state: FleetSessionState): NodeHue {
  const m = sessionStateMeta(state);
  return { dot: m.dot, tint: SESSION_TINT[state] };
}

/**
 * The persona palette, from `SQUARE_VISUAL`'s accent (its `dot`). The idle
 * state is deliberately achromatic — a resting persona should not compete with
 * the ones that are working or waiting.
 */
export const PERSONA_HUE: Record<SquareState, NodeHue> = {
  running:   { dot: SQUARE_VISUAL.running.accent,   tint: 'bg-primary/[0.08]' },
  attention: { dot: SQUARE_VISUAL.attention.accent, tint: 'bg-amber-500/[0.08]' },
  failed:    { dot: SQUARE_VISUAL.failed.accent,    tint: 'bg-red-500/[0.08]' },
  idle:      { dot: SQUARE_VISUAL.idle.accent,      tint: 'bg-foreground/[0.03]' },
};

export function personaHue(state: SquareState): NodeHue {
  return PERSONA_HUE[state];
}

/** A live row sitting past the cap after a Start now. */
export const WARNING_HUE: NodeHue = {
  dot: 'bg-status-warning',
  tint: 'bg-status-warning/[0.08]',
};

// ---------------------------------------------------------------------------
// The team / project swatch — a hue hashed from the name, so the same team
// wears the same square on every board and in every column.
// ---------------------------------------------------------------------------

/** 0..359, stable for a string (djb2). */
export function swatchHue(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i += 1) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** The one letter the swatch carries. */
export function swatchInitial(name: string): string {
  const m = name.trim().match(/\p{L}|\p{N}/u);
  return (m?.[0] ?? '·').toUpperCase();
}

// ── The node's one treatment ────────────────────────────────────────────────
// The board prototyped three dressings (outline / accent / tinted); the
// operator picked TINTED and the other two were deleted. What remains is the
// winner, as constants: the body washed in the state hue with a soft
// elevation and no border, every symbol a solid hue circle with the glyph cut
// out in the background colour, and the elapsed fill drawn as a bar along the
// node's bottom edge (`FleetNode`) instead of a ring in the row.

/** The shell: a soft elevation, no border — the hue wash is the frame. */
export const NODE_SHELL = 'shadow-elevation-1';

/** Every symbol's box: a solid circle. */
export const NODE_CHIP = 'rounded-full';

/** The shell's frame for a hue. */
export function frameClass(hue: NodeHue): string {
  return `${NODE_SHELL} ${hue.tint}`;
}

/**
 * One symbol's box for a hue. Everything inside paints with `currentColor`
 * (`bg-current`, the icon's stroke), so this one class decides the symbol.
 */
export function symbolClass(hue: NodeHue): string {
  return `${NODE_CHIP} ${hue.dot} text-background`;
}

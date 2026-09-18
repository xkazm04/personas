// nodeSymbols — the node's SECOND ROW, as data: which symbols a node shows, in
// which order, in which hue, and how each of the three styles dresses them.
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
// The three styles (`NODE_STYLE`) differ in FRAME, HUE APPLICATION and SYMBOL
// TREATMENT — never in which symbols show. That difference is one data map,
// not three forks: `frameClass` and `symbolClass` read the map.
//
// Hues come from the canonical fleet palette (`fleetStateMeta` through
// `fleetSessionModel`) and the persona palette (`SQUARE_VISUAL`), never a raw
// colour. Tailwind cannot generate an assembled class, so the 8 % tint and the
// per-state border twins are literal tables, tied to the canonical `dot` by a
// lockstep test (`nodeSymbols.test.ts`) exactly as `SESSION_BORDER` is.

import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Bot, Check, CircleDashed, Clock, Hand, Hourglass, Lightbulb, MessageSquare, Moon, Play,
  RotateCcw, Rss, Sparkles, Square,
} from 'lucide-react';
import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { SQUARE_VISUAL, type SquareState } from '../../fleetGridModel';
import { SESSION_BORDER, sessionStateMeta } from '../../fleetSessionModel';

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
// Hue — the five class slots a state paints with.
// ---------------------------------------------------------------------------

export interface NodeHue {
  /** Text / icon colour. */
  text: string;
  /** Solid fill (the dot, the tinted style's symbol circles, the elapsed bar). */
  dot: string;
  /** Border twin of `dot`. */
  border: string;
  /** 8 % wash for the tinted style's body. */
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
  return { text: m.text, dot: m.dot, border: SESSION_BORDER[state], tint: SESSION_TINT[state] };
}

/**
 * The persona palette, from `SQUARE_VISUAL`'s accent (its `dot`). The idle
 * state is deliberately achromatic — a resting persona should not compete with
 * the ones that are working or waiting.
 */
export const PERSONA_HUE: Record<SquareState, NodeHue> = {
  running:   { text: 'text-primary',   dot: SQUARE_VISUAL.running.accent,   border: 'border-primary',        tint: 'bg-primary/[0.08]' },
  attention: { text: 'text-amber-300', dot: SQUARE_VISUAL.attention.accent, border: 'border-amber-400',      tint: 'bg-amber-500/[0.08]' },
  failed:    { text: 'text-red-300',   dot: SQUARE_VISUAL.failed.accent,    border: 'border-red-400',        tint: 'bg-red-500/[0.08]' },
  idle:      { text: 'text-foreground', dot: SQUARE_VISUAL.idle.accent,     border: 'border-border',         tint: 'bg-foreground/[0.03]' },
};

export function personaHue(state: SquareState): NodeHue {
  return PERSONA_HUE[state];
}

/** A live row sitting past the cap after a Start now. */
export const WARNING_HUE: NodeHue = {
  text: 'text-status-warning',
  dot: 'bg-status-warning',
  border: 'border-status-warning',
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

// ---------------------------------------------------------------------------
// The three styles.
// ---------------------------------------------------------------------------

export type NodeStyle = 'outline' | 'accent' | 'tinted';

export interface NodeStyleSpec {
  /** Shell classes that need no hue. */
  shell: string;
  /** Which hue slot paints the frame. */
  frameHue: 'border' | 'accent' | 'tint';
  /** The chip every symbol sits in (`''` = a bare glyph). */
  chip: string;
  /**
   * How a NON-state symbol is coloured: monochrome at 70 % (hue only on the
   * state symbol), full foreground inside its chip, or the state hue's
   * solid circle with the glyph cut out of it.
   */
  symbolTone: 'mono' | 'full' | 'inverse';
  title: string;
  /** Where the elapsed fill is drawn: a 12 px ring in the row, or a 2 px bar along the bottom edge. */
  elapsed: 'ring' | 'bar';
}

export const NODE_STYLE: Record<NodeStyle, NodeStyleSpec> = {
  // Quiet: a hairline in the state hue, a transparent body, symbols muted.
  outline: {
    shell: 'border bg-transparent',
    frameHue: 'border',
    chip: '',
    symbolTone: 'mono',
    title: '',
    elapsed: 'ring',
  },
  // Dense: a 3 px accent bar, a secondary body, every symbol in a rounded chip.
  accent: {
    shell: 'border-l-[3px] bg-secondary/20',
    frameHue: 'accent',
    chip: 'rounded-full bg-secondary/40',
    symbolTone: 'full',
    title: 'font-medium',
    elapsed: 'ring',
  },
  // Bold: the body washed in the hue, no border, symbols as hue circles, the
  // elapsed fill as a bar across the bottom edge.
  tinted: {
    shell: 'shadow-elevation-1',
    frameHue: 'tint',
    chip: 'rounded-full',
    symbolTone: 'inverse',
    title: '',
    elapsed: 'bar',
  },
};

export interface FrameOptions {
  /** A queued row: the frame is dashed where the style has a border. */
  queued?: boolean;
}

/** The shell's frame for a style and a hue. */
export function frameClass(style: NodeStyle, hue: NodeHue, o: FrameOptions = {}): string {
  const spec = NODE_STYLE[style];
  const dashed = o.queued ? 'border-dashed' : '';
  switch (spec.frameHue) {
    case 'border': return `${spec.shell} ${hue.border} ${dashed}`.trim();
    case 'accent': return `${spec.shell} ${hue.border} ${dashed}`.trim();
    case 'tint': return `${spec.shell} ${hue.tint}`;
  }
}

/**
 * One symbol's box for a style and a hue. The STATE symbol always carries the
 * hue; the others follow the style's tone. Everything inside the box paints
 * with `currentColor` (`bg-current`, `border-current`, the icon's stroke), so
 * this one class decides the whole symbol.
 */
export function symbolClass(style: NodeStyle, hue: NodeHue, isState: boolean): string {
  const spec = NODE_STYLE[style];
  const inverse = spec.symbolTone === 'inverse';
  if (isState) return `${spec.chip} ${inverse ? `${hue.dot} text-background` : hue.text}`.trim();
  switch (spec.symbolTone) {
    case 'mono': return 'text-foreground opacity-70';
    case 'full': return `${spec.chip} text-foreground`;
    case 'inverse': return `${spec.chip} ${hue.dot} text-background`;
  }
}

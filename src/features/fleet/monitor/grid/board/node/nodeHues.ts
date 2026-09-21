// nodeHues — the node's COLOUR: the hue each state paints with, the team /
// project swatch, and the one treatment (`frameClass` / `symbolClass`).
// Split out of `nodeSymbols.ts` (which re-exports all of it) so each file holds
// one idea: `nodeSymbols` decides WHICH symbols and in which order, this file
// decides how they are coloured. The lockstep test stays `nodeSymbols.test.ts`.

import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { SQUARE_VISUAL, type SquareState } from '../../fleetGridModel';
import { sessionStateMeta } from '../../fleetSessionModel';

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

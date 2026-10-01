/**
 * The draw-in's clock (spark twin-portable-blueprint, round 2): every duration
 * the sheet draws itself with, in one table to tune. The owner accepted a long
 * draw ("the effect will be worth it"), so these favour legibility of the
 * chronology over speed; the rich twin's L1 takes about 6-10 s end to end.
 */

/** Every kind of part the engine draws. */
export const DRAW_KINDS = ['frame', 'stroke', 'tick', 'ink', 'extend', 'rise', 'drop', 'sweep', 'write', 'mark', 'press'] as const;
export type DrawKind = (typeof DRAW_KINDS)[number];

export const DRAW_TIMING = {
  /** One wave of frames: every frame at one nesting depth traces in parallel, then the next depth starts. */
  frameWave: 550,
  /** How long a frame takes to trace inside its wave (the rest of the wave is a breath before the next depth). */
  frameTrace: 520,
  /** Lettering: one letter (or figure) every this many ms. */
  letter: 28,
  /** Content parts, by kind (ms each). */
  stroke: 180,
  tick: 90,
  ink: 420,
  extend: 220,
  rise: 110,
  drop: 110,
  sweep: 200,
  mark: 90,
  press: 420,
  /** The pause before the readiness stamp is pressed, after every other part is drawn. */
  pressGap: 260,
  /** L2 starts drawing this long after the zoom starts to open, once there is paper to draw on. */
  zoomLead: 260,
  /** The pen leaves for its next place this long before the ink arrives there. */
  penLead: 380,
  /** The pen stays at least this long in one place while the content draws, so it never jitters. */
  penDwell: 1100,
} as const;

/** The loop (the working miniature): one draw-hold-erase cycle at least this long. */
export const LOOP_MIN_CYCLE = 5600;
/**
 * In the loop every part draws in the first 12% of its own cycle and holds
 * until 62% (`twd-draw-loop` in draw.css), so the last part must start before
 * half the cycle for the whole plan to stand drawn for a moment.
 */
export const LOOP_LAST_START_SHARE = 0.48;

/** How long one part of `kind` draws; lettering by its letter count. */
export function drawDuration(kind: DrawKind, letters: number): number {
  if (kind === 'write') return Math.max(1, letters) * DRAW_TIMING.letter;
  if (kind === 'frame') return DRAW_TIMING.frameTrace;
  return DRAW_TIMING[kind];
}

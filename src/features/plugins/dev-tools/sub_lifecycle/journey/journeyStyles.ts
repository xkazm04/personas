/**
 * Static class bundles for the journey (Tailwind's JIT must see every class
 * literally). Colour is by meaning (`status-*` tokens), never by palette hue.
 *
 * THE SHAPE LADDER (rebuilt 2026-10-06). A binding state must be legible
 * without colour, and the previous ladder did not deliver that: `pending` and
 * `missing` were BOTH `border-2 border-dashed` and differed only in their
 * status hue, so the one distinction that decides whether the user presses
 * "Install into repo" was carried by colour alone - against the comment in
 * this file that claimed otherwise. `detected` was `border-[3px]
 * border-double`, which on the 14px legend chip spends 6 of 14 pixels on a
 * three-stroke border and composites into a slightly thicker `live`.
 *
 * The ladder now separates all five states on TWO colourless axes, stroke
 * STYLE and stroke WIDTH, with no arbitrary bracket value:
 *
 *   live      solid   2px   the binding is installed and running
 *   detected  solid   1px   observed in the repo, not installed by us
 *   pending   dashed  2px   queued: an install task is in flight
 *   missing   dotted  2px   the most broken stroke, for the most broken state
 *   advisory  dashed  1px   nothing to install; the step is advice
 *
 * Read as a ladder: a CLOSED stroke means the binding exists, an OPEN one that
 * it does not; 2px is a state you can act on, 1px one you only read.
 *
 * Three FILL treatments sit on top of that one ladder, so the skin a variant
 * picks changes how solid the mark looks without ever changing what the shape
 * means (`NODE_MARK`).
 */
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

/** The colourless half of the ladder: style + width, per state. */
const STROKE: Record<LifecycleBindingState, string> = {
  live: 'border-2 border-solid',
  detected: 'border border-solid',
  pending: 'border-2 border-dashed',
  missing: 'border-2 border-dotted',
  advisory: 'border border-dashed',
};

/** `wash` - the state is a colour the step is soaked in. Stroke plus a tint. */
export const STATE_WASH: Record<LifecycleBindingState, string> = {
  live: `${STROKE.live} border-status-success/80 bg-status-success/10`,
  detected: `${STROKE.detected} border-status-info/80 bg-status-info/10`,
  pending: `${STROKE.pending} border-status-warning/80 bg-status-warning/10`,
  missing: `${STROKE.missing} border-status-error/90 bg-status-error/10`,
  advisory: `${STROKE.advisory} border-foreground/45 bg-transparent`,
};

/** `engraved` - no fill anywhere. The mark is a stroke on the page. */
export const STATE_STROKE: Record<LifecycleBindingState, string> = {
  live: `${STROKE.live} border-status-success bg-transparent`,
  detected: `${STROKE.detected} border-status-info bg-transparent`,
  pending: `${STROKE.pending} border-status-warning bg-transparent`,
  missing: `${STROKE.missing} border-status-error bg-transparent`,
  advisory: `${STROKE.advisory} border-foreground/55 bg-transparent`,
};

/** `plated` - the step is a raised plate: a heavier tint and an outer ring. */
export const STATE_PLATE: Record<LifecycleBindingState, string> = {
  live: `${STROKE.live} border-status-success/70 bg-status-success/15 shadow-sm shadow-status-success/20`,
  detected: `${STROKE.detected} border-status-info/70 bg-status-info/15 shadow-sm shadow-status-info/20`,
  pending: `${STROKE.pending} border-status-warning/70 bg-status-warning/15 shadow-sm shadow-status-warning/20`,
  missing: `${STROKE.missing} border-status-error/80 bg-status-error/15 shadow-sm shadow-status-error/25`,
  advisory: `${STROKE.advisory} border-foreground/40 bg-foreground/[0.04]`,
};

/** The three fills, addressed by the skin's `nodeMark`. */
export const NODE_MARK = {
  wash: STATE_WASH,
  stroke: STATE_STROKE,
  plate: STATE_PLATE,
} as const;

export type NodeMark = keyof typeof NODE_MARK;

export const STATE_TEXT: Record<LifecycleBindingState, string> = {
  live: 'text-status-success',
  detected: 'text-status-info',
  pending: 'text-status-warning',
  missing: 'text-status-error',
  advisory: 'text-foreground',
};

/**
 * The small state chip in the legend and the binding list: the SAME ladder, so
 * the legend is a truthful key to the rail in every skin. Hollow by default -
 * the chip is a key, not a value - and the skin decides its size (it needs at
 * least 16px for a 2px dash to read as more than one dash per side).
 */
export const STATE_CHIP: Record<LifecycleBindingState, string> = {
  live: `${STROKE.live} border-status-success`,
  detected: `${STROKE.detected} border-status-info`,
  pending: `${STROKE.pending} border-status-warning`,
  missing: `${STROKE.missing} border-status-error`,
  advisory: `${STROKE.advisory} border-foreground/55`,
};

/** Evidence dots: filled = done, hollow = skipped, dashed ring = unknown, error token = failed. */
export const OUTCOME_DOT: Record<LifecycleOutcome, string> = {
  done: 'bg-status-success border border-status-success',
  skipped: 'bg-transparent border border-foreground/70',
  unknown: 'bg-transparent border border-dashed border-foreground/40',
  failed: 'bg-status-error border border-status-error',
};

export const OUTCOME_TEXT: Record<LifecycleOutcome, string> = {
  done: 'text-status-success',
  skipped: 'text-foreground',
  unknown: 'text-foreground',
  failed: 'text-status-error',
};

export const LEGEND_STATES: LifecycleBindingState[] = ['live', 'detected', 'pending', 'missing', 'advisory'];

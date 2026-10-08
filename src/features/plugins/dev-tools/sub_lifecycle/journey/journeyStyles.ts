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
 * The ladder separates all five states on TWO colourless axes, stroke STYLE
 * and stroke WIDTH, with no arbitrary bracket value:
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
 * 2026-10-06, SECOND PASS: there used to be THREE fill treatments here
 * (`STATE_WASH` / `STATE_STROKE` / `STATE_PLATE`) addressed through a
 * `NODE_MARK` map, because a prototype round made the variant axis a SKIN. The
 * owner threw that round out - "to change colors of borders or background is
 * not prototyping nor component redesign" - so the kept treatment is the only
 * one left, under a name that describes what it IS (a state mark) rather than
 * the finish it was branded with. A concept that needs to draw a state
 * differently draws it in its own directory; it does not add a column here.
 */
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';

/** The colourless half of the ladder: style + width, per state. */
const STROKE: Record<LifecycleBindingState, string> = {
  live: 'border-2 border-solid',
  detected: 'border border-solid',
  pending: 'border-2 border-dashed',
  missing: 'border-2 border-dotted',
  advisory: 'border border-dashed',
};

/**
 * The state mark: the colourless stroke ladder plus the status tint the step is
 * soaked in. One treatment, because the surface has one look.
 */
export const STATE_MARK: Record<LifecycleBindingState, string> = {
  live: `${STROKE.live} border-status-success/80 bg-status-success/10`,
  detected: `${STROKE.detected} border-status-info/80 bg-status-info/10`,
  pending: `${STROKE.pending} border-status-warning/80 bg-status-warning/10`,
  missing: `${STROKE.missing} border-status-error/90 bg-status-error/10`,
  advisory: `${STROKE.advisory} border-foreground/45 bg-transparent`,
};

export const STATE_TEXT: Record<LifecycleBindingState, string> = {
  live: 'text-status-success',
  detected: 'text-status-info',
  pending: 'text-status-warning',
  missing: 'text-status-error',
  advisory: 'text-foreground',
};

/**
 * The small state chip in the legend and the binding list: the SAME ladder, so
 * the legend is a truthful key to the rail. Hollow by default - the chip is a
 * key, not a value - and the call site sizes it (it needs at least 16px for a
 * 2px dash to read as more than one dash per side).
 */
export const STATE_CHIP: Record<LifecycleBindingState, string> = {
  live: `${STROKE.live} border-status-success`,
  detected: `${STROKE.detected} border-status-info`,
  pending: `${STROKE.pending} border-status-warning`,
  missing: `${STROKE.missing} border-status-error`,
  advisory: `${STROKE.advisory} border-foreground/55`,
};

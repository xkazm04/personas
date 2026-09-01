import type { RailWidth } from '../grid/rail/useRailWidth';

/* ----------------------------------------------------------------------------
 * THE RESIZE HANDLE — one element, three rails.
 *
 * It stands IN for the rail's border rather than sitting beside it, so the
 * affordance is exactly where the edge the operator wants to move already is.
 * `handleProps` (from `useRailWidth`) carries the splitter ARIA — role,
 * orientation, valuenow/min/max — the tab stop and the arrow keys along with
 * the pointer wiring: a resize reachable only by pointer is not a smaller
 * feature, it is an inoperable one for anyone who needs the wider rail most.
 *
 * Lifted out of `ActivityRail`, which shipped it inline on 2026-09-01 and is
 * still rendering its own copy — the two are the same markup and the same hook,
 * and pointing ActivityRail at this file is a one-import change that this lot's
 * write set did not reach. Do that rather than growing a third copy.
 * -------------------------------------------------------------------------- */

export function RailSplitter({
  rail, label, side = 'right', bordered = true, testId,
}: {
  rail: RailWidth;
  /** What the splitter is called, for the screen reader. */
  label: string;
  /** Which side of the handle the rail it resizes is on — decides which of the
   *  handle's own borders is painted, nothing more. */
  side?: 'left' | 'right';
  /** Off when the panel beside it already draws that edge, so the two do not
   *  paint the same 1px twice. */
  bordered?: boolean;
  testId?: string;
}) {
  const edge = !bordered ? '' : side === 'right' ? 'border-l border-border' : 'border-r border-border';
  return (
    <div
      {...rail.handleProps}
      aria-label={label}
      data-testid={testId}
      className={`group relative w-1 flex-shrink-0 cursor-col-resize transition-colors focus-ring ${edge} ${
        rail.dragging ? 'bg-primary/40' : 'hover:bg-primary/25'
      }`}
    >
      {/* A 1px target is not a target. The hit area is widened either side
          without widening the paint. */}
      <span aria-hidden className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <span
        aria-hidden
        className={`absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
          rail.dragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/50'
        }`}
      />
    </div>
  );
}

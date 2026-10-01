import { useEffect, useImperativeHandle, useState, type Ref, type RefObject } from 'react';
import DraftingPen from '@/features/studio/guide/drafting/DraftingPen';
import type { DrawPlan } from './draw/drawPlan';
import { DRAW_TIMING } from './draw/drawTiming';
import { useSheetPen } from './useSheetPen';

export interface SheetPenHandle {
  /** A drawing has planned itself (again, with the same start, on a re-read). */
  draw: (plan: DrawPlan, startedAt: number) => void;
  /** The drawing is drawn, or gone. */
  lift: () => void;
}

/**
 * The drafting pen (Studio's `DraftingPen`), led by the draw-in: it sets down
 * on the largest frame of each wave, then hops to a container that is
 * writing, then to the stamp, leaving `penLead` early because its glide takes
 * most of a second (so it arrives with the ink, never after it). Once the
 * sheet is drawn it follows the stage as before. Its own state, so moving the
 * pen never re-renders the sheet: one timer per waypoint, a dozen per drawing.
 */
export default function SheetPen({
  handle,
  rootRef,
  find,
  targetKey,
  targetSection,
  working,
  busy,
  active,
  reduced,
}: {
  handle: Ref<SheetPenHandle>;
  rootRef: RefObject<HTMLDivElement | null>;
  find: (key: string | null) => HTMLElement | null;
  targetKey: string | null;
  targetSection: string | null;
  working: boolean;
  /** The nib is lowered (working) rather than resting. */
  busy: boolean;
  active: boolean;
  reduced: boolean;
}) {
  const [run, setRun] = useState<{ plan: DrawPlan; t0: number; step: number } | null>(null);
  useImperativeHandle(
    handle,
    () => ({
      draw: (plan, t0) => setRun((r) => ({ plan, t0, step: r && r.t0 === t0 ? r.step : 0 })),
      lift: () => setRun(null),
    }),
    [],
  );

  const t0 = run?.t0 ?? null;
  const pen = run?.plan.pen ?? null;
  useEffect(() => {
    if (t0 === null || !pen || reduced) return;
    const elapsed = performance.now() - t0;
    const timers = pen.map((w, i) =>
      window.setTimeout(() => setRun((r) => (r && r.t0 === t0 ? { ...r, step: i } : r)), Math.max(0, w.at - DRAW_TIMING.penLead - elapsed)),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [t0, pen, reduced]);

  const waypoint = run ? (run.plan.pen[run.step]?.el ?? null) : null;
  const drawAt = waypoint && waypoint.isConnected ? waypoint : null;
  const at = useSheetPen({ drawAt, targetKey, targetSection, working, active, reduced, find });
  if (reduced || !at) return null;
  return (
    <div data-testid="twd-pen">
      <DraftingPen rootRef={rootRef} target={at} working={drawAt !== null || busy} callout={null} />
    </div>
  );
}

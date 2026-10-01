/**
 * The draw-in engine's root (spark twin-portable-blueprint, round 2): one per
 * drawing (the L1 plan, each L2 zoom, the stage sheet). On mount it plans its
 * subtree once (drawPlan.ts), writes the schedule onto the parts, and is
 * `drawing` until the last part is drawn, then `done`; `instant` (reduced
 * motion, or a plan already seen) never plans and shows everything drawn.
 *
 * The drafting sheet's tree, as the planner finds it (frames by depth, then
 * each container's content in reading order):
 *
 *   sheet border, regions, title block, notes ......... frames, depth 0
 *   region: balloon, name, share, ink to the share, tick ... its content
 *     identity: bio scale + extension lines (d1); BIO, figure, dimension line
 *               languages: each balloon (d1) letters its code
 *     voice:    channel: elevation box + tick baseline (d1); name, stations
 *               rise 1..8, sample ticks, rule ticks
 *     knowledge: tally: baseline (d1); label, count, strokes one by one
 *               facts, knowledge base (book d1)
 *     training: topic: track (d1), tier marks (d2); name, figures, bar, hatch
 *               goal gauge (d1): fill rises, number; kinds strip (d1): linings
 *   title block: cells (d1), readiness slots (d2); label, name, role, slot
 *               fills; the readiness stamp is pressed last on the sheet
 *
 * Nothing re-renders per step: a plan is one pass at mount (again only if the
 * sheet re-lays its rows out while it still draws), and its end is one timer.
 * A part that mounts later is not scheduled and simply shows drawn.
 */
import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { applyPlan, keepEngineEvents } from './drawApply';
import { planDraw, type DrawPlan } from './drawPlan';
import { DRAW_TIMING } from './drawTiming';
import './draw.css';

export type DrawState = 'instant' | 'drawing' | 'done';

/** Whether parts under it may draw themselves in (<Write> letters only then). Stable per mount. */
export const DrawContext = createContext<{ live: boolean }>({ live: false });
const LIVE = { live: true };
const STILL = { live: false };

// CSSProperties declares no custom properties; this key is the engine's own, read only by draw.css.
const ROOT_VARS = { '--draw-letter': DRAW_TIMING.letter } as CSSProperties;

export interface DrawSheetProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Draw nothing in: reduced motion, or a drawing this mount has already shown. */
  instant: boolean;
  /** Stop now and show the rest drawn (stage: an answer arrived while the sheet still drew). */
  finish?: boolean;
  /** ms before the first frame (a zoom draws once there is paper to draw on). */
  offset?: number;
  /** A change re-reads the drawing while it still draws (rows moved in or out by a resize). */
  replanKey?: unknown;
  onPlan?: (plan: DrawPlan, startedAt: number) => void;
  onDone?: () => void;
  /** The drawing leaves the screen (whatever its state). */
  onLeave?: () => void;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

export default function DrawSheet({ instant, finish = false, offset = 0, replanKey, onPlan, onDone, onLeave, ref, style, children, ...rest }: DrawSheetProps) {
  const own = useRef<HTMLDivElement | null>(null);
  const clock = useRef<{ t0: number; painted: boolean } | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const state: DrawState = instant ? 'instant' : finish || timeUp ? 'done' : 'drawing';
  const drawing = state === 'drawing';

  const calls = useRef({ onPlan, onDone, onLeave });
  useLayoutEffect(() => {
    calls.current = { onPlan, onDone, onLeave };
  });

  useLayoutEffect(() => {
    const el = own.current;
    if (!el || !drawing) return;
    const now = performance.now();
    if (!clock.current) {
      const c = { t0: now, painted: false };
      clock.current = c;
      requestAnimationFrame(() => {
        c.painted = true;
      });
    }
    const { t0, painted } = clock.current;
    const plan = planDraw(el, offset);
    // Before the first paint nothing has drawn yet, so a re-read re-times everything.
    applyPlan(plan, painted ? now - t0 : 0, painted);
    setEndsAt(t0 + plan.total);
    calls.current.onPlan?.(plan, t0);
  }, [drawing, offset, replanKey]);

  useEffect(() => {
    if (!drawing || endsAt === null) return;
    const timer = window.setTimeout(() => setTimeUp(true), Math.max(0, endsAt - performance.now()) + 60);
    return () => window.clearTimeout(timer);
  }, [drawing, endsAt]);

  useEffect(() => {
    if (state === 'done') calls.current.onDone?.();
  }, [state]);

  // A layout cleanup, so it runs before the next drawing's plan on a swap (L1 to L2).
  useLayoutEffect(() => () => calls.current.onLeave?.(), []);

  // Attached before the first animation can start (the first style pass after this commit).
  useLayoutEffect(() => (own.current ? keepEngineEvents(own.current.ownerDocument) : undefined), []);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  return (
    <DrawContext.Provider value={instant ? STILL : LIVE}>
      <div ref={setRef} data-draw-root="" data-draw-state={state} style={style ? { ...ROOT_VARS, ...style } : ROOT_VARS} {...rest}>
        {children}
      </div>
    </DrawContext.Provider>
  );
}

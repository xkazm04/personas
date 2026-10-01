import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { applyLoop, keepEngineEvents } from './drawApply';
import { planDraw } from './drawPlan';
import { DrawContext } from './DrawSheet';
import './draw.css';

const STILL = { live: false };

/**
 * The engine in a loop: the subtree is planned exactly as a one-shot drawing
 * (frames by depth, then each container's content), then drawn, held and
 * lifted away over and over by one CSS animation per part (`twd-draw-loop`).
 * `live` false (reduced motion) plans nothing and leaves it drawn. Lettering
 * inside a loop never letters (it would flicker every turn).
 */
export default function DrawLoop({ live, children, ...rest }: { live: boolean; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const own = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (!el || !live) return;
    applyLoop(planDraw(el), el);
    // A loop fires an iteration event per part per turn, forever: none of them leaves the drawing.
    return keepEngineEvents(el.ownerDocument);
  }, [live]);
  return (
    <DrawContext.Provider value={STILL}>
      <div ref={own} data-draw-root="" data-draw-state={live ? 'loop' : 'instant'} {...rest}>
        {children}
      </div>
    </DrawContext.Provider>
  );
}

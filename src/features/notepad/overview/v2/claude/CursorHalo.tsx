// THE CURSOR: one element for the whole grid, springing from card to card.
//
// Deliberately NOT a framer `layoutId` handed between slots. A shared-layout
// element inside a slot that is leaving (a Find query narrowing past the
// selected card) holds that slot's `AnimatePresence` exit open, so the card
// never unmounts — a stuck ghost card. One absolutely-positioned halo that
// animates to the selected slot's LAYOUT box (offset*, which ignore the reflow
// transforms) has no exit to block, and during a filter reflow it glides to
// where the card is going rather than where it is.
import { useLayoutEffect, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Halo stands this many px proud of the card on every side. */
const PROUD = 6;

export function CursorHalo({
  gridRef,
  selectedId,
  layoutKey,
  reduced,
}: {
  /** The positioned grid the slots live in (their offsetParent). */
  gridRef: RefObject<HTMLElement | null>;
  selectedId: string | null;
  /** Changes whenever the set or order of slots changes (re-measure). */
  layoutKey: string;
  reduced: boolean;
}) {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !selectedId) {
      setBox(null);
      return;
    }
    const measure = () => {
      const slot = grid.querySelector<HTMLElement>(`[data-slot="${selectedId}"]`);
      setBox(slot ? { x: slot.offsetLeft, y: slot.offsetTop, w: slot.offsetWidth, h: slot.offsetHeight } : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridRef, selectedId, layoutKey]);

  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 560, damping: 42, mass: 0.8 };

  return (
    <AnimatePresence>
      {box && (
        <motion.div
          key="cursor"
          aria-hidden
          data-testid="notepad-v2c-cursor"
          className="pointer-events-none absolute left-0 top-0 z-10 rounded-modal border-2 border-primary/70 bg-primary/5"
          initial={{ opacity: 0, x: box.x - PROUD, y: box.y - PROUD, width: box.w + PROUD * 2, height: box.h + PROUD * 2 }}
          animate={{ opacity: 1, x: box.x - PROUD, y: box.y - PROUD, width: box.w + PROUD * 2, height: box.h + PROUD * 2 }}
          exit={{ opacity: 0 }}
          transition={spring}
        >
          <span className="absolute -inset-1 -z-10 rounded-modal bg-primary/15 blur-md" />
          <span className="absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

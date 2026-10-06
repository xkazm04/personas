/** The annotated sheet's small inked marks: a frame's colour mixed into the
 *  ink, the tick a finished region carries, and the stamp that lands when the
 *  drawing is approved (screened) or issued (promoted). */
import { AnimatePresence, motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";

/** A dimension's colour, inked: mixed into the sheet ink so the eight colours
 *  read as one drawing rather than eight stickers. */
export const dimInk = (color: string) => `color-mix(in srgb, ${color} 62%, var(--ink))`;

/** The mark a finished region carries, bottom right. */
export function InkTick({ color, delay = 0 }: { color: string; delay?: number }) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.i
      aria-hidden
      initial={shouldAnimate ? { opacity: 0, scale: 2, rotate: 45 } : false}
      animate={{ opacity: 0.95, scale: 1, rotate: 45 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      className="pointer-events-none absolute bottom-2 right-3 block h-2.5 w-1.5"
      style={{ borderRight: `1.5px solid ${color}`, borderBottom: `1.5px solid ${color}` }}
    />
  );
}

/** The stamp: dropped from above with a spring, rotated like a hand stamp.
 *  Announced to assistive tech through an always-mounted live region. */
export function InkStamp({ stamp }: { stamp: string | null }) {
  const { shouldAnimate } = useMotion();
  return (
    <>
      <span className="sr-only" aria-live="polite">{stamp ?? ""}</span>
      <AnimatePresence>
        {stamp && (
          <motion.span
            key={stamp}
            aria-hidden
            data-testid="annotated-stamp"
            initial={shouldAnimate ? { opacity: 0, scale: 2.4, rotate: -8 } : { opacity: 0.92, rotate: -8 }}
            animate={{ opacity: 0.92, scale: 1, rotate: -8 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 16, delay: shouldAnimate ? 0.4 : 0 }}
            className="pointer-events-none absolute right-2 top-1 z-10 rounded-interactive px-2.5 py-1"
            style={{ ...LETTERING, fontSize: 15, letterSpacing: "0.18em", color: "var(--ink-strong)", border: "2.5px solid var(--ink-strong)" }}
          >
            {stamp}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

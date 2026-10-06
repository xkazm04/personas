/** DimensionLine - a drafted dimension along an edge of the sheet: two
 *  extension lines, the dimension line itself drawn left to right, an
 *  architect's slash at each end, and the measurement lettered on a chip in
 *  the middle. Absolutely placed in stage pixels by the caller. */
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { LETTERING } from "../blueprint";

interface DimensionLineProps {
  x: number;
  /** The line's y; the chip is centred on it. */
  y: number;
  w: number;
  label: string;
  /** Extension lines run toward the sheet: down from a top dimension, up from a bottom one. */
  toward: "down" | "up";
  elRef?: (el: HTMLElement | null) => void;
  testId?: string;
}

const EXT = 9;

export function DimensionLine({ x, y, w, label, toward, elRef, testId }: DimensionLineProps) {
  const { shouldAnimate } = useMotion();
  if (w < 40) return null;
  const extTop = toward === "down" ? -3 : -EXT + 3;
  return (
    <div ref={elRef} aria-hidden data-testid={testId} className="pointer-events-none absolute" style={{ left: x, top: y, width: w, height: 0 }}>
      {[0, w].map((at) => (
        <i key={at} className="absolute block w-px" style={{ left: at, top: extTop, height: EXT, background: "var(--ink-dim)" }} />
      ))}
      <motion.i
        className="absolute left-0 top-0 block h-px w-full origin-left"
        style={{ background: "var(--ink-dim)" }}
        initial={shouldAnimate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      {[0, w].map((at) => (
        <i key={`s${at}`} className="absolute block h-px w-2.5" style={{ left: at - 5, top: 0, background: "var(--ink)", transform: "rotate(-45deg)" }} />
      ))}
      <motion.span
        className="absolute left-1/2 top-0 whitespace-nowrap rounded-interactive px-1.5"
        style={{ ...LETTERING, fontSize: 11, lineHeight: "16px", color: "var(--ink)", background: "var(--background)", transform: "translate(-50%, -50%)" }}
        initial={shouldAnimate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: shouldAnimate ? 0.45 : 0 }}
      >
        {label}
      </motion.span>
    </div>
  );
}

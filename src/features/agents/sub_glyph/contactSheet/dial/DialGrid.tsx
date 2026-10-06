/** DialGrid - the construction grid under the dial, on its own layer so it
 *  can recede with the drawing: when a sector or a question is pulled out,
 *  the grid fades to half on the same move the dial sinks back, and the
 *  nested layer stands on a quieter sheet. Opacity only. */
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { SHEET_MOVE, SHEET_MOVE_REDUCED } from "../cinema/useCamera";

export function DialGrid({ receded }: { receded: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      data-testid="dial-grid"
      className="bp-grid pointer-events-none absolute inset-0"
      initial={false}
      animate={{ opacity: receded ? 0.5 : 1 }}
      transition={reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE}
    />
  );
}

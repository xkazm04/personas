/** The Drafting Sheet's two moves, and its stamp. Both moves animate the
 *  `transform` string and `opacity` only (compositor-side, no blur): the
 *  camera's push into one of Cinema's layers, and the page turn between
 *  sheets. The transform strings share one shape so framer interpolates them. */
import type { Variants } from "framer-motion";
import type { SheetAct } from "../cinema/sheetModel";
import { COPY } from "./copy";

const SLIDE = 7;

/** Sheet 1 under the camera: at rest, pushed into a layer, turned away. */
export const CAM = {
  rest: { transform: "translateX(0%) scale(1)", opacity: 1 },
  pushed: { transform: "translateX(0%) scale(2.5)", opacity: 0 },
  away: { transform: `translateX(-${SLIDE}%) scale(1)`, opacity: 0 },
  /** Reduced motion: a fade, no travel. */
  fade: { transform: "translateX(0%) scale(1)", opacity: 0 },
} as const;

/** A page turn: the next sheet slides in from the side it lies on. */
export const TURN = { duration: 0.55, ease: [0.3, 0.7, 0.2, 1] as const };

/** `custom` is the direction: 1 forward (in from the right), -1 back. */
export const TURN_VARIANTS: Variants = {
  enter: (dir: number) => ({ transform: `translateX(${dir * SLIDE}%)`, opacity: 0 }),
  center: { transform: "translateX(0%)", opacity: 1 },
  exit: (dir: number) => ({ transform: `translateX(${-dir * SLIDE}%)`, opacity: 0 }),
};

export const TURN_VARIANTS_REDUCED: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

/** The stamp that lands on the title block, and its ink. */
export function stampOf(act: SheetAct, passed: boolean | null | undefined): { text: string; tone: string } | null {
  if (act === "verdict" && passed) return { text: COPY.stamp.approved, tone: "var(--status-success)" };
  if (act === "premiere") return { text: COPY.stamp.issued, tone: "var(--ink-strong)" };
  if (act === "stopped") return { text: COPY.stamp.void, tone: "var(--status-error)" };
  return null;
}

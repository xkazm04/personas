/** SectorInk - one ring segment drawn in an ink state, shared by the dial's
 *  sectors, the flying sector and the exploded fan's sub-sectors, so the
 *  nested view speaks the main frame's line language exactly:
 *    pending   a dashed outline, nothing inside (still to draw);
 *    drafting  the outline inked hard, hatch lines running inside it;
 *    asking    a dashed outline in the dimension's colour, breathing;
 *    done      filled in the dimension's colour, outline drawn on;
 *    error     the status error ink.
 *  The outline of every solid state draws itself on (a one-shot stroke). */
import { useId } from "react";
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Ink } from "../dialMarks";

interface SectorInkProps {
  d: string;
  ink: Ink;
  color: string;
  /** Carries metadata: the only way to the dimension's full colour. */
  populated: boolean;
  /** Bounding square of the shape, for the hatch lines. */
  box: { x: number; y: number; size: number };
}

function Hatch({ d, box }: { d: string; box: SectorInkProps["box"] }) {
  const id = useId().replace(/:/g, "");
  const lines: string[] = [];
  const { x, y, size } = box;
  for (let k = -size - 20; k <= size + 10; k += 10) lines.push(`M${x + k} ${y + size}L${x + k + size} ${y}`);
  return (
    <>
      <defs><clipPath id={`${id}-clip`}><path d={d} /></clipPath></defs>
      <g clipPath={`url(#${id}-clip)`}>
        <path className="dial-hatch" d={lines.join("")} stroke="var(--ink-dim)" strokeWidth={1} />
      </g>
    </>
  );
}

export function SectorInk({ d, ink, color, populated, box }: SectorInkProps) {
  const { shouldAnimate } = useMotion();
  const draw = shouldAnimate ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.9, ease: "easeOut" as const } } : {};
  const fadeIn = shouldAnimate ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.6, delay: 0.35 } } : {};

  if (ink === "pending") {
    return <path d={d} fill="none" stroke="var(--ink-dim)" strokeWidth={1} strokeDasharray="3 4" />;
  }
  if (ink === "asking") {
    return <path className="dial-asking" d={d} fill={colorWithAlpha(color, 0.08)} stroke={color} strokeWidth={1.6} strokeDasharray="6 3" />;
  }
  if (ink === "drafting") {
    return (
      <g>
        <Hatch d={d} box={box} />
        <motion.path key="drafting" d={d} fill="none" stroke="var(--ink-strong)" strokeWidth={1.3} {...draw} />
      </g>
    );
  }
  const stroke = ink === "error" ? "var(--status-error)" : populated ? color : "var(--ink)";
  const fill = ink === "error"
    ? "color-mix(in srgb, var(--status-error) 16%, transparent)"
    : populated ? colorWithAlpha(color, 0.36) : "color-mix(in srgb, var(--ink) 16%, transparent)";
  return (
    <g>
      <motion.path key={`${ink}-fill`} d={d} fill={fill} stroke="none" {...fadeIn} />
      <motion.path key={`${ink}-line`} d={d} fill="none" stroke={stroke} strokeWidth={1.4} {...draw} />
    </g>
  );
}

/** The tick a finished part carries: two strokes, drawn on. */
export function InkTick({ x, y, color }: { x: number; y: number; color: string }) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.path
      d={`M${x - 3.5} ${y}L${x - 1} ${y + 2.8}L${x + 4} ${y - 3.2}`}
      fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : false}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.45, delay: 0.7, ease: "easeOut" }}
    />
  );
}

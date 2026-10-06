/** SweepArm - the dial's pen. A needle on the ring that swings to the part
 *  drawn last, with a faint wedge trailing it and the kit's nib breathing at
 *  its tip while the build works. It is an HTML square centred on the pivot,
 *  rotated with a transform only (compositor work), and it always takes the
 *  short way round. Used by the dial (pivot = centre) and by the exploded fan
 *  (pivot = the fan's apex), so the nested view has the same pen. */
import { useState } from "react";
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import type { Pt } from "../dialGeometry";

interface SweepArmProps {
  pivot: Pt;
  /** Needle from r0 to r1 (px). */
  r0: number;
  r1: number;
  /** Target angle in degrees, clockwise; 0 points up. */
  angle: number | null;
  working: boolean;
  /** Angle the needle rests at with nothing drawn yet. */
  rest?: number;
}

/** The nearest equivalent of `target` to `from`, so the swing is never the long way. */
function nearest(from: number, target: number): number {
  return from + ((((target - from) % 360) + 540) % 360) - 180;
}

export function SweepArm({ pivot, r0, r1, angle, working, rest = 0 }: SweepArmProps) {
  const { shouldAnimate } = useMotion();
  const [deg, setDeg] = useState(angle ?? rest);
  const target = angle ?? rest;
  const next = nearest(deg, target);
  if (Math.abs(next - deg) > 0.01) setDeg(next);
  const size = r1 * 2 + 16;
  const m = size / 2;
  const wedge = (a: number) => ({ x: m + r1 * Math.sin((a * Math.PI) / 180), y: m - r1 * Math.cos((a * Math.PI) / 180) });
  const w0 = wedge(-7);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: pivot.x - m, top: pivot.y - m, width: size, height: size }}
      initial={false}
      animate={{ rotate: next, opacity: angle === null ? 0.35 : working ? 1 : 0.7 }}
      transition={shouldAnimate ? { duration: 0.9, ease: [0.3, 0.7, 0.2, 1] } : { duration: 0 }}
    >
      <svg width={size} height={size} className="overflow-visible">
        <path
          d={`M${m} ${m - r0}L${m} ${m - r1}A${r1} ${r1} 0 0 0 ${w0.x} ${w0.y}Z`}
          fill="color-mix(in srgb, var(--ink) 14%, transparent)"
        />
        <line x1={m} y1={m - r0} x2={m} y2={m - r1} stroke="var(--ink-strong)" strokeWidth={1.5} />
        <path d={`M${m - 3.5} ${m - r1 + 7}L${m + 3.5} ${m - r1 + 7}L${m} ${m - r1}Z`} fill="var(--ink-strong)" />
        <circle className={working ? "dial-nib" : undefined} cx={m} cy={m - r1 - 4} r={2.5} fill="var(--ink-strong)" />
      </svg>
    </motion.div>
  );
}

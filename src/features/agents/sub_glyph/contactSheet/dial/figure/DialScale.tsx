/** DialScale - the instrument's construction: a degree scale (minor graduation
 *  every 2.5°, major every 15°, a cardinal every 90°), the hairline circles
 *  that bound the rim and the sector ring, and the face behind the hub, lit by
 *  how much of the persona has been crowned into being. It is the construction
 *  grid's analogue: drawn once per session, swept in clockwise from 12 o'clock
 *  by a masked stroke (a one-shot draw, not a loop), never redrawn. */
import { memo, useId } from "react";
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { RADII, radial, type Pt } from "../dialGeometry";

interface DialScaleProps {
  c: Pt;
  R: number;
  accent: string;
  /** 0..1: the face glow (the Cinema sigil core's presence). */
  presence: number;
  /** A new key sweeps the scale in again (a new build session). */
  sweepKey: string;
}

function graduations(c: Pt, R: number) {
  let minor = "", major = "", cardinal = "";
  for (let i = 0; i < 144; i++) {
    const a = i * 2.5;
    if (a % 90 === 0) cardinal += radial(c, R * 0.93, R * RADII.outer, a);
    else if (a % 15 === 0) major += radial(c, R * RADII.majorIn, R * RADII.outer, a);
    else minor += radial(c, R * RADII.minorIn, R * RADII.outer, a);
  }
  return { minor, major, cardinal };
}

export const DialScale = memo(function DialScale({ c, R, accent, presence, sweepKey }: DialScaleProps) {
  const { shouldAnimate } = useMotion();
  const id = useId().replace(/:/g, "");
  const g = graduations(c, R);
  const ring = (r: number, dashed = false, stroke = "var(--ink-faint)") => (
    <circle cx={c.x} cy={c.y} r={R * r} fill="none" stroke={stroke} strokeWidth={1} strokeDasharray={dashed ? "2 5" : undefined} />
  );

  return (
    <g aria-hidden>
      <defs>
        <radialGradient id={`${id}-face`}>
          <stop offset="0%" style={{ stopColor: colorWithAlpha(accent, 0.1 + presence * 0.18) }} />
          <stop offset="72%" style={{ stopColor: colorWithAlpha(accent, 0.02) }} />
          <stop offset="100%" style={{ stopColor: "transparent" }} />
        </radialGradient>
        <mask id={`${id}-sweep`}>
          <motion.circle
            key={sweepKey}
            cx={c.x} cy={c.y} r={R * 0.9} fill="none" stroke="white" strokeWidth={R * 0.25}
            transform={`rotate(-90 ${c.x} ${c.y})`}
            initial={shouldAnimate ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.6, ease: [0.3, 0.7, 0.2, 1] }}
          />
        </mask>
      </defs>
      <circle cx={c.x} cy={c.y} r={R * RADII.face} fill={`url(#${id}-face)`} />
      <circle cx={c.x} cy={c.y} r={R * RADII.face} fill="none" stroke="var(--ink-faint)" strokeWidth={1} />
      <g mask={`url(#${id}-sweep)`}>
        {ring(RADII.outer, false, "var(--ink-dim)")}
        <path d={g.minor} stroke="var(--ink-faint)" strokeWidth={1} />
        <path d={g.major} stroke="var(--ink-dim)" strokeWidth={1} />
        <path d={g.cardinal} stroke="var(--ink)" strokeWidth={1.5} />
        {ring(RADII.rimIn, true)}
        {ring(RADII.sectorOut)}
        {ring(RADII.sectorIn)}
      </g>
    </g>
  );
});

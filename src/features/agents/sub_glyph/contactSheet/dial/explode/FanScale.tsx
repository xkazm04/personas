/** FanScale - the dial's degree scale, magnified onto the fan's outer edge:
 *  one graduation per real degree, a longer one every 5°, the dial's own
 *  numerals every 15°. Swept in along the arc by a masked stroke, the same
 *  one-shot draw the dial's scale uses. */
import { useId } from "react";
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { FAN_HALF, HALF_SPAN, fanAngle, fanPolar, type Pt } from "../dialGeometry";

export function FanScale({ apex, rO, theta }: { apex: Pt; rO: number; theta: number }) {
  const { shouldAnimate } = useMotion();
  const id = useId().replace(/:/g, "");
  let minor = "", major = "";
  const numerals: { phi: number; text: string }[] = [];
  for (let real = Math.ceil(theta - HALF_SPAN); real <= Math.floor(theta + HALF_SPAN); real++) {
    const phi = fanAngle(theta, real);
    const big = real % 5 === 0;
    const a = fanPolar(apex, rO - (big ? 12 : 6), phi), b = fanPolar(apex, rO, phi);
    const seg = `M${a.x} ${a.y}L${b.x} ${b.y}`;
    if (big) major += seg; else minor += seg;
    if (real % 15 === 0) numerals.push({ phi, text: `${String(((real % 360) + 360) % 360).padStart(3, "0")}°` });
  }
  const s = fanPolar(apex, rO - 10, -FAN_HALF), e = fanPolar(apex, rO - 10, FAN_HALF);
  return (
    <g aria-hidden>
      <defs>
        <mask id={`${id}-wipe`}>
          <motion.path
            d={`M${s.x} ${s.y}A${rO - 10} ${rO - 10} 0 0 1 ${e.x} ${e.y}`}
            fill="none" stroke="white" strokeWidth={30}
            initial={shouldAnimate ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.3, 0.7, 0.2, 1] }}
          />
        </mask>
      </defs>
      <g mask={`url(#${id}-wipe)`}>
        <path d={minor} stroke="var(--ink-dim)" strokeWidth={1} />
        <path d={major} stroke="var(--ink)" strokeWidth={1.2} />
        {numerals.map((nm) => {
          const at = fanPolar(apex, rO - 20, nm.phi);
          return (
            <text key={nm.text} x={at.x} y={at.y} dy={3.5} textAnchor="middle" transform={`rotate(${nm.phi + 90} ${at.x} ${at.y})`} className="typo-code" fill="var(--ink-dim)">
              {nm.text}
            </text>
          );
        })}
      </g>
    </g>
  );
}

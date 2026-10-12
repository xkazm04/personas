/** DialRim - the gauge. Every thing the build has learned is a tick on the rim
 *  band above its dimension's sector, laid clockwise from the sector's start
 *  at 3° (closer when a sector collects more than fits), one tick per drawing
 *  step: a capability, a connector, a trigger, a channel, an event, an answer
 *  given on the sheet, a screening result (longer, in its status ink). */
import { memo } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { RADII, polar, sectorSpan, type Pt } from "../dialGeometry";
import type { DialMark } from "../dialMarks";

const PITCH = 3;

/** Where a sector's i-th of n rim ticks sits, in dial degrees. */
export function rimAngle(dim: GlyphDimension, i: number, n: number): number {
  const [a0, a1] = sectorSpan(dim);
  const room = a1 - a0 - 3;
  return a0 + 1.5 + i * Math.min(PITCH, n > 1 ? room / (n - 1) : PITCH);
}

function tickColor(m: DialMark): string {
  if (m.tone === "good") return "var(--status-success)";
  if (m.tone === "bad") return "var(--status-error)";
  return DIM_META[m.dim].color;
}

export const DialRim = memo(function DialRim({ c, R, ticks }: { c: Pt; R: number; ticks: Record<GlyphDimension, DialMark[]> }) {
  const { shouldAnimate } = useMotion();
  return (
    <g aria-hidden>
      {GLYPH_DIMENSIONS.flatMap((dim) => ticks[dim].map((m, i) => {
        const a = rimAngle(dim, i, ticks[dim].length);
        const p = polar(c, R * RADII.rimIn, a);
        const q = polar(c, R * (m.kind === "test" ? RADII.majorIn : RADII.rimOut), a);
        return (
          <motion.line
            key={m.id}
            x1={p.x} y1={p.y} x2={q.x} y2={q.y}
            stroke={tickColor(m)} strokeWidth={2} strokeLinecap="round"
            initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : false}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        );
      }))}
    </g>
  );
});

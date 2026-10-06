/** DialLeaders - the leader lines from each sector to its readout in the side
 *  columns: a dot where the line leaves the sector, a knee, a run to the chip
 *  and a short end tick. A sector still to draw keeps a faint dotted leader
 *  (its slot is reserved, the spacer trick); an inked one takes its colour.
 *  The leader of the step drawn last is re-drawn hard, from the sector out, as
 *  the pen writes its callout into that readout. */
import { memo } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Readout } from "../dialGeometry";
import type { Ink } from "../dialMarks";

interface DialLeadersProps {
  readouts: Record<GlyphDimension, Readout>;
  ink: Record<GlyphDimension, Ink>;
  populated: Record<GlyphDimension, boolean>;
  /** The step drawn last, whose leader is re-drawn (null: none). */
  callout: { id: string; dim: GlyphDimension } | null;
}

const pathOf = (r: Readout) => `M${r.p0.x} ${r.p0.y}L${r.knee.x} ${r.knee.y}L${r.end.x} ${r.end.y}`;

export const DialLeaders = memo(function DialLeaders({ readouts, ink, populated, callout }: DialLeadersProps) {
  const { shouldAnimate } = useMotion();
  return (
    <g aria-hidden fill="none">
      {GLYPH_DIMENSIONS.map((dim) => {
        const r = readouts[dim];
        const drawn = ink[dim] !== "pending";
        const color = DIM_META[dim].color;
        const stroke = !drawn ? "var(--ink-faint)" : populated[dim] ? colorWithAlpha(color, 0.55) : "var(--ink-dim)";
        return (
          <g key={dim}>
            <path d={pathOf(r)} stroke={stroke} strokeWidth={1} strokeDasharray={drawn ? undefined : "1 4"} />
            <circle cx={r.p0.x} cy={r.p0.y} r={drawn ? 2.2 : 1.5} fill={drawn ? stroke : "var(--ink-dim)"} />
            <path d={`M${r.end.x} ${r.end.y - 5}L${r.end.x} ${r.end.y + 5}`} stroke={stroke} strokeWidth={1} />
          </g>
        );
      })}
      {callout && (
        <motion.path
          key={callout.id}
          d={pathOf(readouts[callout.dim])}
          stroke="var(--ink-strong)" strokeWidth={1.5}
          initial={shouldAnimate ? { pathLength: 0, opacity: 1 } : { opacity: 1 }}
          animate={{ pathLength: 1, opacity: [1, 1, 0.35] }}
          transition={{ pathLength: { duration: 0.7, ease: "easeOut" }, opacity: { duration: 4.2, times: [0, 0.8, 1] } }}
        />
      )}
    </g>
  );
});

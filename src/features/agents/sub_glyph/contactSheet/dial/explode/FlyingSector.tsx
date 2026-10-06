/** FlyingSector - the pull-out itself. An exact copy of the clicked sector,
 *  in its ink, lifts out of the dial along its bisector and swells while the
 *  dial behind it dims; it hands over to the magnified fan by fading as the
 *  fan draws on. Closing plays it backwards: the copy reappears out on the
 *  bisector and re-seats into its slot as the dial wakes. Transform and
 *  opacity only. Its slot keeps a dashed outline while it is out (the
 *  spacer trick: the part is away, its place is not). */
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, PETAL_ANGLES } from "@/features/shared/glyph";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { RADII, annulus, sectorPoint, sectorSpan, type Pt } from "../dialGeometry";
import type { Ink } from "../dialMarks";
import { SectorInk } from "../figure/SectorInk";

interface FlyingSectorProps {
  dim: GlyphDimension;
  c: Pt;
  R: number;
  stage: { w: number; h: number };
  ink: Ink;
  populated: boolean;
}

const EASE = [0.3, 0.7, 0.2, 1] as const;

export function FlyingSector({ dim, c, R, stage, ink, populated }: FlyingSectorProps) {
  const reduce = useReducedMotion();
  const [a0, a1] = sectorSpan(dim);
  const d = annulus(c, R * RADII.sectorIn, R * RADII.sectorOut, a0, a1);
  const mid = sectorPoint(c, R, dim);
  const t = (PETAL_ANGLES[dim] * Math.PI) / 180;
  const out = { x: Math.sin(t) * R * 0.16, y: -Math.cos(t) * R * 0.16 };
  const size = R * 0.6;
  const box = { x: mid.x - size / 2, y: mid.y - size / 2, size };
  const svg = (children: React.ReactNode) => (
    <svg width={stage.w} height={stage.h} className="absolute inset-0 overflow-visible">{children}</svg>
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {svg(<path d={d} fill="none" stroke={colorWithAlpha(DIM_META[dim].color, 0.45)} strokeDasharray="3 4" />)}
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: `${mid.x}px ${mid.y}px`, willChange: "transform, opacity" }}
        initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
        animate={reduce ? { opacity: 0 } : { x: out.x, y: out.y, scale: 1.18, opacity: 0 }}
        exit={reduce ? { opacity: 0, transition: { duration: 0.2 } } : { x: [out.x, 0], y: [out.y, 0], scale: [1.18, 1], opacity: [1, 1, 0], transition: { duration: 0.6, ease: EASE, opacity: { duration: 0.6, times: [0, 0.75, 1] } } }}
        transition={reduce ? { duration: 0.2 } : {
          x: { duration: 0.55, ease: EASE }, y: { duration: 0.55, ease: EASE }, scale: { duration: 0.55, ease: EASE },
          opacity: { duration: 0.35, delay: 0.5 },
        }}
      >
        {svg(
          <g>
            <SectorInk d={d} ink={ink === "pending" ? "pending" : "done"} color={DIM_META[dim].color} populated={populated} box={box} />
          </g>,
        )}
      </motion.div>
    </div>
  );
}

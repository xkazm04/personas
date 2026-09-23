/** SheetSigil — the living persona sigil laid UNDER the contact sheet.
 *
 *  It is Cinema's GlyphHeroSigil (guide rings, core, eight petal hit-areas)
 *  centred on the centre cell and sized so each petal reaches into the frame
 *  it names: the frames are arranged by PETAL_ANGLES, so the petal at 90°
 *  points into the Apps frame, the one at 0° into When, and so on. Over the
 *  hero sigil we paint the petals themselves, lit in their dimension colour as
 *  the frames above them develop. Clicking a petal opens its frame. */
import { memo } from "react";
import { motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS, PETAL_ANGLES } from "@/features/shared/glyph";
import { GlyphHeroSigil } from "@/features/shared/glyph/persona-sigil";
import type { PetalState } from "@/features/shared/glyph/persona-sigil";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { EASE } from "./cinemaMotion";

interface SheetSigilProps {
  size: number;
  cx: number;
  cy: number;
  petalStates: Record<GlyphDimension, PetalState>;
  activeDim: GlyphDimension | null;
  accent: string;
  /** 0..1 — how much of the persona has been crowned into being. */
  presence: number;
  onPetal: (dim: GlyphDimension) => void;
}

const FILL: Record<PetalState, number> = { idle: 0, filling: 0.06, pending: 0.2, resolved: 0.13, error: 0.12 };
const STROKE: Record<PetalState, number> = { idle: 0.1, filling: 0.25, pending: 0.85, resolved: 0.5, error: 0.6 };

export const SheetSigil = memo(function SheetSigil({ size, cx, cy, petalStates, activeDim, accent, presence, onPetal }: SheetSigilProps) {
  if (size < 80) return null;
  const c = size / 2;
  const outer = size * 0.44;
  const inner = size * 0.13;
  const w = size * 0.065;
  const petal = `M 0 -${inner} C ${w} -${outer * 0.49}, ${w} -${outer * 0.77}, 0 -${outer} C -${w} -${outer * 0.77}, -${w} -${outer * 0.49}, 0 -${inner} Z`;

  return (
    <motion.div
      className="absolute pointer-events-none text-foreground"
      initial={false}
      animate={{ left: cx - c, top: cy - c, width: size, height: size }}
      transition={{ duration: 0.9, ease: EASE }}
    >
      <div
        className="absolute rounded-full"
        style={{
          inset: size * 0.2,
          background: `radial-gradient(circle, ${colorWithAlpha(accent, 0.1 + presence * 0.16)}, transparent 68%)`,
          transition: "background 0.8s ease",
        }}
      />
      <div className="absolute inset-0 opacity-70">
        <GlyphHeroSigil
          size={size}
          petalStates={petalStates}
          hoveredDim={null}
          activeDim={activeDim}
          onHover={() => {}}
          onClick={onPetal}
        />
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {GLYPH_DIMENSIONS.map((dim) => {
          const st = petalStates[dim];
          const color = st === "error" ? "#fb923c" : DIM_META[dim].color;
          const dimOther = activeDim !== null && activeDim !== dim;
          return (
            <g key={dim} transform={`translate(${c} ${c}) rotate(${PETAL_ANGLES[dim]})`}>
              <g className={st === "pending" ? "glyph-petal-pending" : undefined}>
                <path
                  d={petal}
                  fill={color}
                  stroke={color}
                  strokeWidth={st === "pending" ? 2 : 1.3}
                  style={{
                    fillOpacity: dimOther ? FILL[st] * 0.3 : FILL[st],
                    strokeOpacity: dimOther ? STROKE[st] * 0.3 : STROKE[st],
                    transition: "fill-opacity 0.8s ease, stroke-opacity 0.8s ease",
                  }}
                />
              </g>
            </g>
          );
        })}
      </svg>
    </motion.div>
  );
});

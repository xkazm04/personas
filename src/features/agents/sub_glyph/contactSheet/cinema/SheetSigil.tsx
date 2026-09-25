/** SheetSigil — the living persona sigil laid UNDER the contact sheet.
 *
 *  It is Cinema's GlyphHeroSigil (guide rings, core, eight petal hit-areas)
 *  centred on the centre cell and sized so each petal reaches into the frame
 *  it names: the frames are arranged by PETAL_ANGLES, so the petal at 90°
 *  points into the Apps frame, the one at 0° into When, and so on. Over the
 *  hero sigil we paint the petals themselves. A petal is lit in its dimension
 *  colour only when its dimension is POPULATED (sheetModel.isPopulated, the
 *  same rule the frame follows); an empty one keeps its faint outline, and a
 *  pending or filling one says so with its pulse, not with colour. Clicking a
 *  petal opens its frame.
 *
 *  The hero sigil underneath only supplies the rings, the core and the petal
 *  hit-areas; its own petal paths are invisible. It is therefore handed idle
 *  states, so it never runs its CSS pulse on shapes nobody can see. */
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
  populated: Record<GlyphDimension, boolean>;
  accent: string;
  /** 0..1 — how much of the persona has been crowned into being. */
  presence: number;
  onPetal: (dim: GlyphDimension) => void;
}

/** Populated petals: full colour. */
const FILL: Record<PetalState, number> = { idle: 0.13, filling: 0.13, pending: 0.2, resolved: 0.13, error: 0.12 };
const STROKE: Record<PetalState, number> = { idle: 0.5, filling: 0.5, pending: 0.85, resolved: 0.5, error: 0.6 };
/** Empty petals: the initial semi-transparent outline, a touch firmer while asked about. */
const EMPTY_FILL: Record<PetalState, number> = { idle: 0, filling: 0, pending: 0.03, resolved: 0, error: 0.12 };
const EMPTY_STROKE: Record<PetalState, number> = { idle: 0.1, filling: 0.14, pending: 0.3, resolved: 0.1, error: 0.6 };

const HERO_IDLE = Object.fromEntries(GLYPH_DIMENSIONS.map((d) => [d, "idle"])) as Record<GlyphDimension, PetalState>;
const noHover = () => {};

export const SheetSigil = memo(function SheetSigil({ size, cx, cy, petalStates, populated, accent, presence, onPetal }: SheetSigilProps) {
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
          petalStates={HERO_IDLE}
          hoveredDim={null}
          activeDim={null}
          onHover={noHover}
          onClick={onPetal}
        />
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {GLYPH_DIMENSIONS.map((dim) => {
          const st = petalStates[dim];
          const color = st === "error" ? "#fb923c" : DIM_META[dim].color;
          const full = populated[dim];
          return (
            <g key={dim} transform={`translate(${c} ${c}) rotate(${PETAL_ANGLES[dim]})`}>
              <g className={st === "pending" ? "glyph-petal-pending" : undefined}>
                <path
                  d={petal}
                  fill={color}
                  stroke={color}
                  strokeWidth={st === "pending" ? 2 : 1.3}
                  style={{
                    fillOpacity: full ? FILL[st] : EMPTY_FILL[st],
                    strokeOpacity: full ? STROKE[st] : EMPTY_STROKE[st],
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

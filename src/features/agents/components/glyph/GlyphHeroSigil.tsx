import { motion } from "framer-motion";
import { DIM_META, PETAL_ANGLES, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { PetalState } from "./glyphLayoutTypes";

interface GlyphHeroSigilProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  onHover: (d: GlyphDimension | null) => void;
  onClick: (d: GlyphDimension) => void;
  /** Subdued treatment for the building phase: petals fade to the
   *  background while the orbit progress carries the activity. */
  dimmed?: boolean;
}

export function GlyphHeroSigil({
  size, petalStates, hoveredDim, activeDim, onHover, onClick, dimmed = false,
}: GlyphHeroSigilProps) {
  const center = size / 2;
  const petalOuter = size * 0.44;
  const petalInner = size * 0.13;
  const coreR = size * 0.19;
  const guideInner = size * 0.30;

  const petalPath =
    `M 0 -${petalInner} C ${size * 0.065} -${petalOuter * 0.49}, ${size * 0.065} -${petalOuter * 0.77}, 0 -${petalOuter} ` +
    `C -${size * 0.065} -${petalOuter * 0.77}, -${size * 0.065} -${petalOuter * 0.49}, 0 -${petalInner} Z`;

  const glowId = "glyph-full-hero-glow";
  const coreGrad = "glyph-full-hero-core";

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className="absolute inset-0 pointer-events-none transition-opacity duration-500"
      style={{ opacity: dimmed ? 0.45 : 1 }}
    >
      <defs>
        <radialGradient id={coreGrad} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#60a5fa" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
        </radialGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx={center} cy={center} r={petalOuter + 8} fill="none" stroke="currentColor" strokeOpacity="0.06" />
      <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity="0.10" />
      <circle cx={center} cy={center} r={guideInner} fill="none" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="2,6" />

      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const meta = DIM_META[dim];
        const state = petalStates[dim];
        const isHovered = hoveredDim === dim;
        const isActive = activeDim === dim;
        const dimOther = activeDim !== null && !isActive;

        const fillOpacity =
          state === "resolved" ? (isHovered ? 0.9 : 0.75)
          : state === "pending" ? 0.8
          : state === "filling" ? 0.35
          : state === "error" ? 0.6
          : isHovered ? 0.12 : 0;
        const strokeOpacity =
          state === "resolved" || state === "pending" ? 0.95
          : state === "filling" ? 0.6
          : state === "error" ? 0.9
          : isHovered ? 0.7 : 0.25;
        const dash = state === "idle" ? "4,5" : state === "filling" ? "6,3" : undefined;
        const color = state === "error" ? "#fb923c" : meta.color;

        return (
          <motion.g
            key={dim}
            transform={`translate(${center} ${center}) rotate(${angle})`}
            style={{ cursor: "pointer", pointerEvents: "auto", opacity: dimOther ? 0.25 : 1 }}
            animate={
              state === "pending" ? { scale: [1, 1.08, 1] }
              : state === "filling" ? { scale: [1, 1.025, 1] }
              : { scale: 1 }
            }
            transition={
              state === "pending" ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              : state === "filling" ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.25 }
            }
            onMouseEnter={() => onHover(dim)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => { e.stopPropagation(); onClick(dim); }}
          >
            <path
              d={petalPath}
              fill={color}
              fillOpacity={fillOpacity}
              stroke={color}
              strokeWidth={state === "pending" ? 2 : state === "resolved" ? 1.6 : 1.3}
              strokeOpacity={strokeOpacity}
              strokeDasharray={dash}
              filter={state === "resolved" || state === "pending" ? `url(#${glowId})` : undefined}
            />
            {state === "resolved" && <circle cx={0} cy={-petalOuter + 8} r={3.5} fill="#fff" opacity="0.95" />}
            {state === "pending" && (
              <motion.circle cx={0} cy={-petalOuter + 8} r={4.5} fill="#fff"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.2, repeat: Infinity }} />
            )}
          </motion.g>
        );
      })}

      <circle cx={center} cy={center} r={coreR + 12} fill="none" stroke="currentColor" strokeOpacity="0.08" />
      <circle cx={center} cy={center} r={coreR + 2} fill={`url(#${coreGrad})`} />
      <circle cx={center} cy={center} r={coreR} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" />
    </svg>
  );
}

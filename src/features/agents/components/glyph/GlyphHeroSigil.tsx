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
  size, petalStates, activeDim, onHover, onClick, dimmed = false,
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
      className="absolute inset-0 transition-opacity duration-500"
      // 2026-05-05 — removed `pointer-events-none` from the SVG root so
      // descendant elements (motion.g petals, path with pointer-events: all)
      // are reliably hit-testable across browsers. The SVG default
      // `visiblePainted` keeps empty SVG regions click-through; only
      // painted shapes capture, and the decorative core circles below
      // are individually flagged `pointer-events: none`.
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

      <circle cx={center} cy={center} r={petalOuter + 8} fill="none" stroke="currentColor" strokeOpacity="0.06" style={{ pointerEvents: "none" }} />
      <circle cx={center} cy={center} r={petalOuter} fill="none" stroke="currentColor" strokeOpacity="0.10" style={{ pointerEvents: "none" }} />
      <circle cx={center} cy={center} r={guideInner} fill="none" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="2,6" style={{ pointerEvents: "none" }} />

      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const meta = DIM_META[dim];
        const state = petalStates[dim];
        const isActive = activeDim === dim;
        const dimOther = activeDim !== null && !isActive;

        // 2026-05-05 — leaf petal SVGs are now invisible; only their
        // geometry serves as the click/hover hit-area. Visual reactivity
        // moved to the AuraFrame's glow halo + per-petal label in
        // GlyphPetalIcons. Keep fill/stroke colors set so SVG hit-testing
        // works (`pointer-events: all` ignores fill, but defining color
        // keeps the path well-formed). The opacities are forced to 0 so
        // the leaves never paint.
        const fillOpacity = 0;
        const strokeOpacity = 0;
        const dash: string | undefined = undefined;
        const color = state === "error" ? "#fb923c" : meta.color;

        return (
          // 2026-05-05 — wrap motion.g inside a plain <g> that holds the
          // SVG transform attribute. Earlier the motion.g had BOTH the
          // SVG `transform=` and a framer-motion `animate={{ scale: ... }}`,
          // which compiles to inline CSS `transform: none/scale(N)` that
          // OVERRIDES the SVG transform attribute (CSS transforms on SVG
          // replace, not compose with, SVG `transform=` attrs). All 8
          // petals collapsed to SVG origin (0,0), invisible at the wrong
          // hit-test position. Only the AURA SVGs (which use CSS absolute
          // left/top in GlyphPetalIcons) rendered at the visually correct
          // petal positions, masking the bug. Splitting the transforms
          // across two nested <g> elements lets each apply its own
          // transform without conflict.
          <g key={dim} transform={`translate(${center} ${center}) rotate(${angle})`}>
          <motion.g
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
              // SVG's default hit-testing (`visiblePainted`) only catches
              // clicks on painted regions. For idle empty petals
              // (fillOpacity=0), that limits clickability to the thin
              // stroke outline. `pointer-events: all` makes the entire
              // leaf body capture pointer events regardless of fill or
              // stroke visibility — required so the user can hover/click
              // empty petals to access the compose-phase quick-setup
              // (Memory toggle, Connector picker, etc.).
              style={{ pointerEvents: "all" }}
            />
            {/* Resolved/pending tip-marker circles removed alongside the
                visible leaf — the per-dim AuraFrame glow halo (in
                GlyphPetalIcons) now carries that signal. */}
          </motion.g>
          </g>
        );
      })}

      {/* Inner core decoration. The filled gradient circle (middle) is
          painted across radius 0..coreR+2, which overlaps each petal's
          base region (petalInner..coreR+2). Without `pointer-events:
          none` it would intercept clicks intended for the petal motion.g
          underneath, since SVG hit-testing prefers later-rendered
          painted shapes. */}
      <circle cx={center} cy={center} r={coreR + 12} fill="none" stroke="currentColor" strokeOpacity="0.08" style={{ pointerEvents: "none" }} />
      <circle cx={center} cy={center} r={coreR + 2} fill={`url(#${coreGrad})`} style={{ pointerEvents: "none" }} />
      <circle cx={center} cy={center} r={coreR} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" style={{ pointerEvents: "none" }} />
    </svg>
  );
}

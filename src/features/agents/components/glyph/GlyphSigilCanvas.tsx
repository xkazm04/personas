import { motion, AnimatePresence } from "framer-motion";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { PetalState } from "./glyphLayoutTypes";
import { GlyphHeroSigil } from "./GlyphHeroSigil";
import { GlyphPetalIcons } from "./GlyphPetalIcons";
import { GlyphOrbitProgress } from "./GlyphOrbitProgress";
import { DIM_LABEL } from "./glyphLayoutHelpers";

interface GlyphSigilCanvasProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  onHoverDim: (d: GlyphDimension | null) => void;
  onClickDim: (d: GlyphDimension) => void;
  /** Subdued treatment — petals fade so the orbit carries the moment. */
  dimmed?: boolean;
  /** Render the slow orbital progress ring (build phase). */
  showOrbit?: boolean;
  /** Centre core content (status text, primary actions). */
  children: React.ReactNode;
  /** Overlay rendered above the sigil with no scrim — used by the
   *  refine-phase answer card to sit on top of the glyph without dimming
   *  the sigil itself. Pointer-events pass through unless the inner
   *  content opts in. */
  overlay?: React.ReactNode;
}

export function GlyphSigilCanvas({
  size, petalStates, hoveredDim, activeDim, onHoverDim, onClickDim,
  dimmed = false, showOrbit = false, children, overlay,
}: GlyphSigilCanvasProps) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <GlyphHeroSigil
        size={size}
        petalStates={petalStates}
        hoveredDim={hoveredDim}
        activeDim={activeDim}
        onHover={onHoverDim}
        onClick={onClickDim}
        dimmed={dimmed}
      />
      <GlyphPetalIcons
        size={size}
        petalStates={petalStates}
        hoveredDim={hoveredDim}
        activeDim={activeDim}
        dimmed={dimmed}
      />

      {showOrbit && <GlyphOrbitProgress size={size} />}

      <div
        className="absolute flex flex-col items-center justify-center text-center"
        style={{ left: size * 0.22, top: size * 0.22, width: size * 0.56, height: size * 0.56 }}
      >
        {children}
      </div>

      <AnimatePresence>
        {hoveredDim && !activeDim && (
          <motion.span
            key={hoveredDim}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-1/2 -translate-x-1/2 px-3 py-1 rounded-full typo-label font-bold uppercase tracking-[0.18em] pointer-events-none"
            style={{
              top: -14,
              background: `${DIM_META[hoveredDim].color}1f`,
              border: `1px solid ${DIM_META[hoveredDim].color}55`,
              color: DIM_META[hoveredDim].color,
              boxShadow: `0 0 12px ${DIM_META[hoveredDim].color}44`,
            }}
          >
            {DIM_LABEL[hoveredDim]}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Overlay slot — answer card sits over the sigil with no scrim.
          Empty regions stay click-through so the petals beneath remain
          interactive. */}
      {overlay && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
          <div className="pointer-events-auto w-full max-w-md">
            {overlay}
          </div>
        </div>
      )}
    </div>
  );
}

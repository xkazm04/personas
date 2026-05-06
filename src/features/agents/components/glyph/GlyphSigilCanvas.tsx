import type { GlyphDimension } from "@/features/shared/glyph";
import type { PetalState } from "./glyphLayoutTypes";
import { GlyphHeroSigil } from "./GlyphHeroSigil";
import { GlyphPetalIcons } from "./GlyphPetalIcons";
import { GlyphOrbitProgress } from "./GlyphOrbitProgress";
import { useBuildingPetalSweep } from "./useBuildingPetalSweep";

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
  // Sequential petal-lighting sweep during the building phase. Tied to
  // `showOrbit` (== isBuildingOnly upstream) so the sweep starts when
  // the orbit starts and stops when the orbit fast-forwards — petals
  // return to idle in the same beat the orbit fades. See issue #2.
  const sweepDim = useBuildingPetalSweep(showOrbit);
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
        sweepDim={sweepDim}
      />

      {/* Orbit handles its own exit choreography (fast-forward to 360° +
          fade) when `active` flips false, so it stays mounted long
          enough to play the completion animation. Returns null once the
          fade is done — no explicit unmount needed from the parent. */}
      <GlyphOrbitProgress size={size} active={showOrbit} />

      {/* Center children container. `pointer-events-none` lets clicks
          fall through to the petal SVG below — the inner half of every
          petal sits inside this 0.56 × size box and was previously
          unclickable. Interactive children (the "Click to Begin"
          button, building / promoted / draft-ready cores) opt back in
          via their own `pointer-events-auto`. */}
      <div
        className="absolute flex flex-col items-center justify-center text-center pointer-events-none"
        style={{ left: size * 0.22, top: size * 0.22, width: size * 0.56, height: size * 0.56 }}
      >
        {children}
      </div>

      {/* 2026-05-05 — center-top dynamic dim label removed. Per-petal
          orbit labels (rendered always-visible inside GlyphPetalIcons)
          replace it. */}

      {/* Overlay slot — answer card sits over the sigil with no scrim.
          Empty regions stay click-through so the petals beneath remain
          interactive. Width is held at 600px (capped to viewport) so
          every question renders at the same width regardless of how
          many options it has — the user reported the cards jittering
          between ~280px and ~440px during the questionnaire. The
          previous 22rem cap was kept tight to clear the side petals,
          but consistency mattered more to the user; petals are still
          clickable wherever the card doesn't cover them. */}
      {overlay && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
          <div className="pointer-events-auto w-[min(600px,90vw)]">
            {overlay}
          </div>
        </div>
      )}
    </div>
  );
}

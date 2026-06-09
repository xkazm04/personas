import { Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { DIM_META, PETAL_ANGLES, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { PetalState } from "./types";
import { DIM_LABEL } from "./dimLabel";

interface GlyphPetalIconsProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  /** Subdued treatment for the building phase. */
  dimmed?: boolean;
  /** When set, that petal gets a temporary brighter glow that pulses on
   *  and off — used by the build-phase sweep (issue #2). Independent of
   *  `petalStates` so it doesn't conflict with the awaiting_input
   *  per-petal pending pulse. */
  sweepDim?: GlyphDimension | null;
}

export function GlyphPetalIcons({
  size, petalStates, hoveredDim, activeDim, dimmed = false, sweepDim = null,
}: GlyphPetalIconsProps) {
  const prefersReducedMotion = useReducedMotion();
  const center = size / 2;
  const iconR = size * 0.34;
  // Labels sit just outside the petal ring so they don't overlap the
  // pictogram. petalOuter (in GlyphHeroSigil) = size * 0.44; we place
  // labels at 0.51 to clear the petal edge with a few px breathing room.
  const labelR = size * 0.51;
  return (
    // `[&_*]:pointer-events-none` forces every descendant (icon wrappers,
    // CustomArt's AuraFrame divs, inner SVGs, lucide icon container) to
    // also be non-interactive. CSS pointer-events does NOT inherit; without
    // this, the AuraFrame's 78×78 outer div sits on top of the petal SVG
    // and captures clicks at default `auto`, blocking the underlying
    // motion.g handlers in GlyphHeroSigil.
    <div
      className="absolute inset-0 pointer-events-none [&_*]:pointer-events-none transition-opacity duration-500"
      style={{ width: size, height: size, opacity: dimmed ? 0.45 : 1 }}
    >
      {GLYPH_DIMENSIONS.map((dim) => {
        const meta = DIM_META[dim];
        const Icon = meta.icon;
        const angle = PETAL_ANGLES[dim];
        const state = petalStates[dim];
        const rad = ((angle - 90) * Math.PI) / 180;
        const x = center + iconR * Math.cos(rad);
        const y = center + iconR * Math.sin(rad);
        const isHovered = hoveredDim === dim;
        const isActive = activeDim === dim;
        const isSwept = sweepDim === dim;
        const dimOther = activeDim !== null && !isActive;
        // 2026-05-05 — sigil size held constant. Earlier resolved/pending
        // states ramped to 108px (vs 84 idle) to signal activation; the
        // user prefers a uniform layout where activation is shown by the
        // glow halo + label brightness alone, not by size.
        const boxSize = 84;
        const CustomArt = meta.customArt;

        // 2026-05-05 — glow tiers retuned. Resolved/populated sigils stay
        // at base (no glow halo) so the orbit reads calmly during build.
        // Glow only escalates when there's actual activity to signal:
        //   • strong = pending (build asks a question for this dim) /
        //              active (user opened the summary popup) / error +
        //              hover.
        //   • mid    = filling (LLM currently writing this dim) / hover
        //              over a resolved petal.
        //   • base   = everything else, including resolved-no-hover.
        const tier: "base" | "mid" | "strong" =
          state === "pending" || isActive || (state === "error" && isHovered)
            ? "strong"
            : state === "filling" || (state === "resolved" && isHovered)
              ? "mid"
              : "base";
        const glowCfg = tier === "strong"
          ? { bg: "55", shadow: "cc", blur: 32 }
          : tier === "mid"
            ? { bg: "33", shadow: "88", blur: 20 }
            : { bg: "14", shadow: "44", blur: 10 };

        // 2026-05-05 — phase 2 glyph reactivity. Two opacity tracks:
        //   • lucideOpacity — applies ONLY to the lucide Icon path (the
        //     literal pictogram). Hidden when the dim is empty so the
        //     petal reads as "waiting to be filled"; hover surfaces a
        //     faint preview.
        //   • auraOpacity — applies to CustomArt (the per-dim aura SVG
        //     decoration, e.g. TriggerAura, ConnectorAura). Always full
        //     because it's the "SVG around" structural marker the user
        //     wants kept regardless of whether the dim has data.
        // The glow halo span above sits below both and is always visible.
        const lucideOpacity = state === "idle"
          ? isHovered ? 0.55 : 0
          : state === "filling"
            ? 0.9
            : 1;
        const auraOpacity = 1;

        // 2026-05-05 — per-petal label sits radially outside the petal
        // at labelR. Always visible at base brightness; hover/active
        // bumps both opacity and shadow so the active orbit ring lights
        // up. This replaces both the bottom GlyphLegend bar and the
        // dynamic center-top dim label.
        const labelX = center + labelR * Math.cos(rad);
        const labelY = center + labelR * Math.sin(rad);
        const labelEmphasised = isHovered || isActive;

        return (
          <Fragment key={`petal-${dim}`}>
          <div
            key={`icon-${dim}`}
            className="absolute flex items-center justify-center transition-all duration-300 pointer-events-none"
            style={{
              left: x - boxSize / 2, top: y - boxSize / 2,
              width: boxSize, height: boxSize,
              opacity: dimOther ? 0.25 : 1,
              color: state === "resolved" || state === "pending" ? "#fff" : meta.color,
            }}
          >
            {state === "pending" && !prefersReducedMotion ? (
              <motion.span
                className="absolute inset-0 rounded-full pointer-events-none"
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  background: `${meta.color}${glowCfg.bg}`,
                  boxShadow: `0 0 ${glowCfg.blur}px ${meta.color}${glowCfg.shadow}`,
                }}
              />
            ) : (
              <span
                className="absolute inset-0 rounded-full transition-all duration-300 pointer-events-none"
                style={{
                  background: `${meta.color}${glowCfg.bg}`,
                  boxShadow: `0 0 ${glowCfg.blur}px ${meta.color}${glowCfg.shadow}`,
                }}
              />
            )}
            {/* Sweep highlight (issue #2). One petal at a time gets a
                bright pulsing ring during the building phase, advancing
                every ~5s. Sits on top of the base halo so it reads
                clearly even when the petal layer is dimmed. The pulse
                fades on AnimatePresence exit when the sweep dim
                changes — no flicker between petals. */}
            <AnimatePresence>
              {isSwept && (
                <motion.span
                  key={`sweep-${dim}`}
                  className="absolute inset-0 rounded-full pointer-events-none"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: [0, 1, 0.6, 0], scale: [0.85, 1.08, 1.04, 1] }}
                  exit={{ opacity: 0, scale: 1 }}
                  transition={{ duration: 1.4, ease: "easeOut", times: [0, 0.25, 0.6, 1] }}
                  style={{
                    background: `${meta.color}66`,
                    boxShadow: `0 0 38px ${meta.color}cc`,
                  }}
                />
              )}
            </AnimatePresence>
            {CustomArt ? (
              <div
                className="relative pointer-events-none"
                style={{
                  opacity: auraOpacity,
                  filter: tier === "strong"
                    ? `drop-shadow(0 0 8px ${meta.color})`
                    : tier === "mid"
                      ? `drop-shadow(0 0 5px ${meta.color}aa)`
                      : undefined,
                }}
              >
                <CustomArt size={boxSize - 6} iconOpacity={lucideOpacity} />
              </div>
            ) : (
              <Icon
                className="relative transition-opacity duration-200"
                style={{
                  width: boxSize - 30, height: boxSize - 30,
                  opacity: lucideOpacity,
                  filter: tier !== "base" ? `drop-shadow(0 0 6px ${meta.color})` : undefined,
                }}
              />
            )}
          </div>
          {/* Always-visible orbit label, colored by dim. Hover/active
              ramps opacity from 0.65 → 1 and adds a stronger shadow
              halo so the lit orbit point reads at a glance. */}
          <div
            className="absolute flex items-center justify-center pointer-events-none transition-all duration-200"
            style={{
              left: labelX - 44, top: labelY - 9,
              width: 88, height: 18,
              opacity: labelEmphasised ? 1 : 0.65,
              color: meta.color,
              textShadow: labelEmphasised
                ? `0 0 12px ${meta.color}cc, 0 0 4px ${meta.color}88`
                : `0 0 6px ${meta.color}55`,
            }}
          >
            <span className="typo-caption font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
              {DIM_LABEL[dim]}
            </span>
          </div>
          </Fragment>
        );
      })}
    </div>
  );
}

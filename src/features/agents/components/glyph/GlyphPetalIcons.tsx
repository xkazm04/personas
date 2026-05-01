import { motion } from "framer-motion";
import { DIM_META, PETAL_ANGLES, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { PetalState } from "./glyphLayoutTypes";

interface GlyphPetalIconsProps {
  size: number;
  petalStates: Record<GlyphDimension, PetalState>;
  hoveredDim: GlyphDimension | null;
  activeDim: GlyphDimension | null;
  /** Subdued treatment for the building phase. */
  dimmed?: boolean;
}

export function GlyphPetalIcons({
  size, petalStates, hoveredDim, activeDim, dimmed = false,
}: GlyphPetalIconsProps) {
  const center = size / 2;
  const iconR = size * 0.34;
  return (
    <div
      className="absolute inset-0 pointer-events-none transition-opacity duration-500"
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
        const dimOther = activeDim !== null && !isActive;
        const boxSize = state === "resolved" || state === "pending" ? 108 : 84;
        const CustomArt = meta.customArt;

        // Glow tiers — escalating with interest. Base = idle ambient halo so
        // the petal still reads as "lit"; mid = filling/resolved/hover/error;
        // strong = pending/active/resolved-on-hover/error-on-hover.
        const tier: "base" | "mid" | "strong" =
          state === "pending" || isActive
            ? "strong"
            : (state === "resolved" && isHovered) || (state === "error" && isHovered)
              ? "strong"
              : state === "resolved" || state === "error" || state === "filling" || isHovered
                ? "mid"
                : "base";
        const glowCfg = tier === "strong"
          ? { bg: "55", shadow: "cc", blur: 32 }
          : tier === "mid"
            ? { bg: "33", shadow: "88", blur: 20 }
            : { bg: "14", shadow: "44", blur: 10 };

        const iconOpacity = state === "idle"
          ? isHovered ? 0.95 : 0.7
          : state === "filling"
            ? 0.9
            : 1;

        return (
          <div
            key={`icon-${dim}`}
            className="absolute flex items-center justify-center transition-all duration-300"
            style={{
              left: x - boxSize / 2, top: y - boxSize / 2,
              width: boxSize, height: boxSize,
              opacity: dimOther ? 0.25 : 1,
              color: state === "resolved" || state === "pending" ? "#fff" : meta.color,
            }}
          >
            {state === "pending" ? (
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
            {CustomArt ? (
              <div
                className="relative"
                style={{
                  opacity: iconOpacity,
                  filter: tier === "strong"
                    ? `drop-shadow(0 0 8px ${meta.color})`
                    : tier === "mid"
                      ? `drop-shadow(0 0 5px ${meta.color}aa)`
                      : undefined,
                }}
              >
                <CustomArt size={boxSize - 6} />
              </div>
            ) : (
              <Icon
                className="relative"
                style={{
                  width: boxSize - 30, height: boxSize - 30,
                  opacity: iconOpacity,
                  filter: tier !== "base" ? `drop-shadow(0 0 6px ${meta.color})` : undefined,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

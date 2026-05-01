import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { PetalState } from "./glyphLayoutTypes";
import { DIM_LABEL } from "./glyphLayoutHelpers";

interface GlyphLegendProps {
  petalStates: Record<GlyphDimension, PetalState>;
  onSelectDim: (dim: GlyphDimension) => void;
  onHoverDim: (dim: GlyphDimension | null) => void;
}

export function GlyphLegend({ petalStates, onSelectDim, onHoverDim }: GlyphLegendProps) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 max-w-2xl">
      {GLYPH_DIMENSIONS.map((dim) => {
        const meta = DIM_META[dim];
        const state = petalStates[dim];
        return (
          <button
            key={dim}
            type="button"
            onClick={() => onSelectDim(dim)}
            onMouseEnter={() => onHoverDim(dim)}
            onMouseLeave={() => onHoverDim(null)}
            className="flex items-center gap-1.5 typo-caption text-foreground/55 hover:text-foreground cursor-pointer transition-colors"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: meta.color,
                opacity: state === "idle" ? 0.25 : state === "filling" ? 0.5 : 1,
                boxShadow: state === "pending" ? `0 0 8px ${meta.color}` : undefined,
              }}
            />
            {DIM_LABEL[dim]}
          </button>
        );
      })}
    </div>
  );
}

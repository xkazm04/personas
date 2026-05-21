import { motion, AnimatePresence } from "framer-motion";
import type { GlyphRow } from "@/features/shared/glyph";
import { GlyphRowStrip } from "./GlyphRowStrip";

interface GlyphRowSectionProps {
  rows: GlyphRow[];
  activeIndex: number;
  hoveredIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
  onAdd: () => void;
  canAdd: boolean;
}

export function GlyphRowSection({
  rows, activeIndex, hoveredIndex, onSelect, onHover, onAdd, canAdd,
}: GlyphRowSectionProps) {
  if (rows.length === 0) return null;
  const shownIndex = hoveredIndex ?? activeIndex;
  const row = rows[shownIndex];
  const isHoverPreview = hoveredIndex !== null && hoveredIndex !== activeIndex;

  return (
    <div className="flex flex-col items-center gap-2">
      <GlyphRowStrip
        rows={rows}
        activeIndex={activeIndex}
        hoveredIndex={hoveredIndex}
        onSelect={onSelect}
        onHover={onHover}
        onAdd={onAdd}
        canAdd={canAdd}
      />
      {/* Shared active-capability title — replaces per-mini truncated labels
          so the full name is legible and never piles up. */}
      <div className="min-h-[1.75rem] flex items-center justify-center">
        <AnimatePresence mode="wait">
          {row && (
            <motion.span
              key={`${row.id}-${isHoverPreview}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className={`typo-heading-sm font-semibold text-center ${
                isHoverPreview ? "text-foreground italic" : "text-foreground"
              }`}
            >
              {row.title}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

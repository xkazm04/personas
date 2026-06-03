import { motion } from "framer-motion";
import { X } from "lucide-react";
import { DIM_META } from "@/features/shared/glyph";
import type { GlyphDimension } from "@/features/shared/glyph";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";

interface GlyphDimensionSummaryCardProps {
  activeDim: GlyphDimension;
  summary: string[];
  isPreBuild: boolean;
  onClose: () => void;
}

/** Read-only summary popover for an already-resolved dimension. Same
 *  per-dim border + shadow language as GlyphAnswerCard so the two cards
 *  feel like one surface that flips between "answer" and "review". */
export function GlyphDimensionSummaryCard({
  activeDim, summary, isPreBuild, onClose,
}: GlyphDimensionSummaryCardProps) {
  const { label } = useGlyphDimText();
  const meta = DIM_META[activeDim];
  const Icon = meta.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="relative rounded-modal bg-card-bg p-4 flex flex-col gap-2"
      style={{
        border: `1px solid ${meta.color}55`,
        boxShadow: `0 0 24px ${meta.color}33, 0 6px 22px rgba(0,0,0,0.35)`,
      }}
    >
      <div
        className="absolute top-0 left-0 w-full h-1 rounded-t-modal"
        style={{ background: `linear-gradient(90deg, ${meta.color}, transparent)` }}
      />
      <div className="flex items-center gap-2">
        <span
          className="w-6 h-6 rounded-input flex items-center justify-center"
          style={{ background: `${meta.color}33` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: "#fff" }} />
        </span>
        <span className="typo-label font-bold uppercase tracking-[0.18em] text-foreground flex-1">
          {label[activeDim]}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-foreground hover:text-foreground/80"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {summary.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {summary.map((line, i) => (
            <li key={i} className="typo-body text-foreground/85 leading-snug">· {line}</li>
          ))}
        </ul>
      ) : (
        <p className="typo-body text-foreground italic">
          {isPreBuild
            ? "This leaf will fill in once you describe what you want to build."
            : "Not yet populated. Use Edit face to set it manually."}
        </p>
      )}
    </motion.div>
  );
}

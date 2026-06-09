import { useTranslation } from '@/i18n/useTranslation';
import { GLYPH_DIMENSIONS } from './types';
import type { GlyphDimension, GlyphPresence } from './types';
import { DIM_META } from './dimMeta';
import { useGlyphDimText } from './persona-sigil';

interface SigilLegendProps {
  /** Per-dim presence for this sigil — drives each chip's dot fill
   *  (linked = solid, shared = faint, none = hollow) so the legend doubles
   *  as a coverage key, not just a colour↔name map. */
  presence: Record<GlyphDimension, GlyphPresence>;
  /** Shared hover state with the sigil — hovering a chip lights its petal
   *  and vice-versa. */
  hoveredDim: GlyphDimension | null;
  onHover: (dim: GlyphDimension | null) => void;
  /** When set, a chip click drills into that dimension (same as a petal
   *  click). Omit for a read-only key. */
  onSelect?: (dim: GlyphDimension) => void;
  /** `sm` = compact chips for a card footer; `md` = roomier (default). */
  size?: 'sm' | 'md';
}

/**
 * Persistent colour↔dimension key for a Persona Sigil. The InteractiveSigil
 * names a dimension only on hover (one at a time, in the card header); this
 * legend surfaces all eight mappings at once so a first-timer can read the
 * glyph without probing each petal. Hover/focus a chip to light the matching
 * petal; click to drill in — it shares the sigil's hover + select model.
 */
export function SigilLegend({
  presence, hoveredDim, onHover, onSelect, size = 'md',
}: SigilLegendProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const dimText = useGlyphDimText();
  const dot = size === 'sm' ? 8 : 10;

  return (
    <div
      role="group"
      aria-label={c.legend_label}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
    >
      {GLYPH_DIMENSIONS.map((dim) => {
        const meta = DIM_META[dim];
        const p = presence[dim];
        const isHovered = hoveredDim === dim;
        const stateLabel =
          p === 'linked' ? c.presence_linked : p === 'shared' ? c.presence_shared : c.presence_none;
        return (
          <button
            type="button"
            key={dim}
            onMouseEnter={() => onHover(dim)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(dim)}
            onBlur={() => onHover(null)}
            onClick={onSelect ? () => onSelect(dim) : undefined}
            aria-label={c.presence_tooltip
              .replace('{label}', dimText.label[dim])
              .replace('{state}', stateLabel)}
            className={`inline-flex items-center gap-1.5 rounded-interactive px-1.5 py-0.5 outline-none transition-colors focus-visible:bg-secondary/60 ${
              onSelect ? 'cursor-pointer hover:bg-secondary/50' : 'cursor-default'
            }`}
          >
            <span
              aria-hidden
              className="shrink-0 rounded-full transition-transform"
              style={{
                width: dot,
                height: dot,
                background:
                  p === 'linked' ? meta.color : p === 'shared' ? `${meta.color}55` : 'transparent',
                border: `1.5px solid ${meta.color}${p === 'none' ? '99' : ''}`,
                boxShadow: isHovered ? `0 0 8px ${meta.color}` : 'none',
                transform: isHovered ? 'scale(1.2)' : 'scale(1)',
              }}
            />
            <span
              className={`typo-caption whitespace-nowrap text-foreground ${
                isHovered ? 'font-semibold' : 'font-normal'
              }`}
            >
              {dimText.label[dim]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

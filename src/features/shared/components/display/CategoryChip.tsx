import type { CategoryColors } from '@/lib/utils/formatters';
import {
  MEMORY_CATEGORY_COLORS,
  TEAM_MEMORY_CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLORS,
} from '@/lib/utils/formatters';

// ---------------------------------------------------------------------------
// CategoryChip — unified category badge for persona & team memories
//
// Spec: px-2 py-0.5 text-[11px] font-medium rounded-md + 2px left border-l accent
// ---------------------------------------------------------------------------

type ColorSource = 'persona' | 'team';

const COLOR_MAPS: Record<ColorSource, Record<string, CategoryColors>> = {
  persona: MEMORY_CATEGORY_COLORS,
  team: TEAM_MEMORY_CATEGORY_COLORS,
};

interface CategoryChipProps {
  /** Category key (e.g. "fact", "observation"). */
  category: string;
  /** Which color map to look up. Defaults to "persona". */
  source?: ColorSource;
  /** Override the display label (defaults to the map's label or capitalized category). */
  label?: string;
  /** Pass explicit colors instead of looking them up by category. */
  colors?: CategoryColors;
  /** Extra classes appended to the outer element. */
  className?: string;
}

export function CategoryChip({
  category,
  source = 'persona',
  label,
  colors,
  className = '',
}: CategoryChipProps) {
  const resolved = colors ?? COLOR_MAPS[source][category] ?? DEFAULT_CATEGORY_COLORS;
  const displayLabel = label ?? resolved.label ?? category.charAt(0).toUpperCase() + category.slice(1);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md border-l-2 ${resolved.accent} ${resolved.bg} ${resolved.text} ${className}`}
    >
      {displayLabel}
    </span>
  );
}

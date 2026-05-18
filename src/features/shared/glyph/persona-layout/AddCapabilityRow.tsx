import { useState } from 'react';
import { Sparkles, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyCapabilitySigil } from '@/features/shared/glyph/CapabilitySigil';

interface AddCapabilityRowProps {
  onClick: () => void;
}

const SIGIL_SIZE = 72;

/**
 * Dashed empty-state row that sits at the end of the capability list in
 * view mode. Visually matches `UseCaseRow` (same sigil size, same row
 * height) so it reads as the next slot the user could fill.
 *
 * Clicking the row triggers the caller's onClick — typically navigation
 * to Templates → Recipes (mirrors the `recipe` variant of the legacy
 * `EmptyTile` in RecipesVariantSigilGrid).
 *
 * Only rendered in view mode (no persona to extend in adoption pre-seed,
 * and scratch flow has its own "describe new capability" affordance).
 */
export function AddCapabilityRow({ onClick }: AddCapabilityRowProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative w-full text-left rounded-card border border-dashed border-foreground/25 hover:border-primary/55 bg-secondary/10 hover:bg-primary/[0.03] transition-all cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="relative shrink-0">
          <EmptyCapabilitySigil size={SIGIL_SIZE} isHovered={hovered} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="typo-heading font-semibold leading-tight inline-flex items-center gap-1.5 text-foreground/85 group-hover:text-foreground transition-colors">
            <Sparkles className="w-3.5 h-3.5 text-primary/85" />
            {t.agents.use_cases.adopt_a_recipe}
          </div>
          <div className="mt-1 typo-caption text-foreground/55 truncate">
            {t.agents.use_cases.from_curated_catalog}
          </div>
        </div>

        <div className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-foreground/25 group-hover:border-primary/55 text-foreground/55 group-hover:text-primary transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </div>
      </div>
    </button>
  );
}

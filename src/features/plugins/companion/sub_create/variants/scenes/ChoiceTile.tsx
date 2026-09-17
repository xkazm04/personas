import type { ReactNode } from 'react';
import { CSS_DURATION_CLASS } from '@/lib/utils/animation/animationPresets';

export interface ChoiceTileProps {
  title: string;
  description?: string | null;
  selected: boolean;
  /** Shown as a pill in the tile's corner when set. */
  recommendedLabel?: string | null;
  /** One-line reason under the description (usually only on the recommended tile). */
  why?: string | null;
  /** Small status marker (installed / needs install). */
  badge?: ReactNode;
  onSelect: () => void;
  testId?: string;
}

/**
 * A large selectable tile — the two-up choice both the keep/turn-off and
 * the engine-pick scenes are made of. A tile is a selection surface, not
 * a Button primitive: it is a plain `<button>` with `aria-pressed`.
 */
export function ChoiceTile({
  title,
  description,
  selected,
  recommendedLabel,
  why,
  badge,
  onSelect,
  testId,
}: ChoiceTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={testId}
      className={`relative flex min-h-28 flex-1 flex-col items-start gap-1.5 rounded-card border p-4 text-left transition-colors ${CSS_DURATION_CLASS.snappy} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        selected
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-secondary/20 hover:border-primary/20 hover:bg-secondary/40'
      }`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="typo-title-lg text-foreground">{title}</span>
        {recommendedLabel && (
          <span className="typo-label shrink-0 rounded-pill bg-primary/10 px-2 py-0.5 text-primary">
            {recommendedLabel}
          </span>
        )}
      </div>
      {description && <span className="typo-caption">{description}</span>}
      {why && <span className="typo-caption text-primary">{why}</span>}
      {badge && <div className="mt-auto pt-2">{badge}</div>}
    </button>
  );
}

/**
 * SimpleEmptyState — shared zero-persona welcome card.
 *
 * Rendered by both MosaicVariant and ConsoleVariant when `personas.length === 0`.
 * Before Phase 08 the component lived inline inside MosaicVariant as `EmptyMosaic`;
 * Phase 08 (Console) lifted it here so Console can reuse the exact same pattern
 * without duplicating 15 lines of JSX.
 *
 * The CTA calls `onCreate`; callers wire it to `startOnboarding()`.
 *
 * Typography + palette constraints (Phase 11): only `typo-*` + `simple-display`
 * classes, only `simple-accent-{tone}-*` utilities. No raw Tailwind color shades.
 */
import { Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export interface SimpleEmptyStateProps {
  /** Called when the user clicks the primary CTA. Typically `startOnboarding`. */
  onCreate: () => void;
}

/**
 * Welcome hero rendered full-viewport when the user has zero personas.
 *
 * Violet accent to match the Mosaic welcome-hero (both surfaces converge on
 * violet when there is no live inbox activity to tone against).
 */
export function SimpleEmptyState({ onCreate }: SimpleEmptyStateProps) {
  const { t } = useTranslation();
  const s = t.simple_mode;
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="w-16 h-16 rounded-3xl border simple-accent-violet-border simple-accent-violet-soft flex items-center justify-center">
        <Sparkles className="w-8 h-8 simple-accent-violet-text" />
      </div>
      <h1 className="typo-hero simple-display text-foreground">
        {s.empty_assistant_grid_title}
      </h1>
      <p className="typo-body-lg text-foreground/70 max-w-md">
        {s.empty_assistant_grid_body}
      </p>
      <Button variant="primary" onClick={onCreate}>
        {s.empty_assistant_grid_cta}
      </Button>
    </div>
  );
}

import type { GlyphDimension } from '@/features/shared/glyph';

/**
 * Short user-facing labels for the 8 persona dimensions.
 *
 * This map is the **English fallback source** only — live rendering routes
 * through `useGlyphDimText()` (which reads `t.agents.glyph_dim_label`), so
 * petal captions, the sigil-edit modal, and the orbit labels all localize.
 * Kept here so the hook (and any non-React caller) has a stable, complete
 * English snapshot when a locale lags or a key is missing.
 */
export const DIM_LABEL: Record<GlyphDimension, string> = {
  trigger: 'When',
  task: 'What',
  connector: 'Apps',
  message: 'Messages',
  review: 'Review',
  memory: 'Memory',
  event: 'Events',
  error: 'Errors',
};

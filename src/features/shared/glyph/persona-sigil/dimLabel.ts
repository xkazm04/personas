import type { GlyphDimension } from '@/features/shared/glyph';

/**
 * Short user-facing labels for the 8 persona dimensions, rendered on each
 * petal of a Persona Sigil. TODO(i18n): these are pre-existing hardcoded
 * English from the original `glyphLayoutHelpers.ts`; route through
 * `useTranslation` once the petal-icon component accepts a translated
 * label map.
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

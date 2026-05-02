// TRIGGER_ICONS hoisted to `@/features/shared/glyph/triggers` (Wave 5 consolidation).
export { TRIGGER_ICONS } from '@/features/shared/glyph/triggers';

export const PREVIEW_DELAY_MS = 300;

export interface TemplateCardProps {
  review: import('@/lib/bindings/PersonaDesignReview').PersonaDesignReview;
  onAdopt: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  onViewFlows: () => void;
  onTryIt: () => void;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
}

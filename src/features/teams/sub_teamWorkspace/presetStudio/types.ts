import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import type { PresetAdoptionController } from '@/features/templates/sub_presets/usePresetAdoption';

/**
 * Shared prop contract for every in-app preset-adoption variant
 * (Baseline / Blueprint / Pipeline / Split). The adoption controller +
 * customize state live in the host (`PresetProcessHost`) so switching
 * variant tabs preserves the in-flight selection, overrides, and any
 * adoption already underway.
 */
export interface PresetVariantProps {
  preset: TeamPreset;
  a: PresetAdoptionController;
  customizing: boolean;
  setCustomizing: (next: boolean) => void;
}

/** Prop contract for the preset-gallery variants (how the offer is presented). */
export interface PresetGalleryVariantProps {
  presets: TeamPreset[];
  onPick: (preset: TeamPreset) => void;
}

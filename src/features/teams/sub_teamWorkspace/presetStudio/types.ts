import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import type { PresetAdoptionController } from '@/features/templates/sub_presets/usePresetAdoption';

/**
 * Prop contract for the in-app preset-adoption process view
 * (`PresetProcessBlueprint`, the /prototype winner). The adoption controller +
 * customize state live in the host (`PresetProcessHost`) so the view stays
 * presentational and the in-flight selection, overrides, and any adoption
 * already underway survive re-renders.
 */
export interface PresetVariantProps {
  preset: TeamPreset;
  a: PresetAdoptionController;
  customizing: boolean;
  setCustomizing: (next: boolean) => void;
}

/** Prop contract for the preset gallery (`PresetGalleryShowcase`). */
export interface PresetGalleryVariantProps {
  presets: TeamPreset[];
  onPick: (preset: TeamPreset) => void;
}

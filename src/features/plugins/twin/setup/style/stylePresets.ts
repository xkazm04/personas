/**
 * The ten curated presets: ids and dimensions ONLY.
 *
 * No copy lives here. Name, summary, anti-tone line and the gallery sample
 * reply are resolved at render time from `twin.style.presets.<id>.*`, so the
 * catalog is translatable and has one home (census `frozen-ui-copy-constant`).
 * Dimension order is F W H E L D X S, matching `STYLE_DIMENSIONS`.
 */

import type { StylePreset, StylePresetId, TwinStyleDims } from './styleContract';

function dims(
  formality: number,
  warmth: number,
  humor: number,
  energy: number,
  length: number,
  directness: number,
  expressiveness: number,
  detail: number,
): TwinStyleDims {
  return { formality, warmth, humor, energy, length, directness, expressiveness, detail };
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  { id: 'executive-brief', dims: dims(5, 2, 1, 1, 1, 2, 1, 2) },
  { id: 'polished-professional', dims: dims(4, 3, 1, 2, 3, 3, 1, 3) },
  { id: 'consultative-expert', dims: dims(4, 3, 2, 2, 4, 3, 1, 5) },
  { id: 'plainspoken-direct', dims: dims(3, 3, 2, 2, 2, 1, 1, 2) },
  { id: 'warm-helpful', dims: dims(3, 5, 2, 3, 3, 4, 2, 3) },
  { id: 'friendly-casual', dims: dims(2, 4, 3, 3, 2, 3, 3, 2) },
  { id: 'empathic-listener', dims: dims(3, 5, 1, 2, 3, 5, 2, 2) },
  { id: 'upbeat-cheerleader', dims: dims(2, 5, 3, 5, 3, 3, 4, 2) },
  { id: 'witty-wry', dims: dims(2, 3, 5, 3, 2, 2, 2, 2) },
  { id: 'close-informal', dims: dims(1, 5, 4, 4, 2, 2, 5, 1) },
];

export function presetById(id: string | null | undefined): StylePreset | null {
  return STYLE_PRESETS.find((p) => p.id === id) ?? null;
}

export function isStylePresetId(id: string | null | undefined): id is StylePresetId {
  return presetById(id) !== null;
}

/**
 * Persona Sigil — the canonical big-glyph component representing a
 * persona (8 petals = 8 persona dimensions). Used by all three layout
 * modes (view / adoption / scratch); only petal-state + interactivity
 * differ per mode.
 */
export { GlyphHeroSigil } from './GlyphHeroSigil';
export { GlyphSigilCanvas } from './GlyphSigilCanvas';
export { GlyphPetalIcons } from './GlyphPetalIcons';
export { GlyphOrbitProgress } from './GlyphOrbitProgress';
export { useBuildingPetalSweep } from './useBuildingPetalSweep';
export { DIM_LABEL } from './dimLabel';
export { CELL_KEY_TO_DIM, DIM_TO_CELL_KEY } from './cellDimMap';
export { useGlyphDimText } from './useGlyphDimText';
export type { GlyphDimText } from './useGlyphDimText';
export type { PetalState } from './types';

// Which dimension glyph set the canvas paints with. Three sets ship side by
// side so they can be compared live and any one reverted instantly:
//   line    — lucide outline icons (the original set)
//   forge   — the same metaphors, restyled solid + full-bleed (dimGlyphsForge)
//   concept — different METAPHORS, chosen per what a dimension measures
//             (dimGlyphsConcept)
// The eventual state is a fusion — a per-dimension pick across the three — so
// the sets are kept as parallel records keyed by DimKey, which makes a
// per-key merge a data change rather than a rewrite.
// Tool BRAND marks (Supabase, Sentry, GitHub…) render in ALL sets — a real
// logo outranks any generic glyph; the set only decides the fallback.
// Provided by MastermindPage and read directly by the glyph renderers, so the
// choice doesn't have to be threaded through every island prop chain.
import { createContext, useContext } from 'react';

import { CONCEPT_GLYPH } from './dimGlyphsConcept';
import { FORGE_GLYPH } from './dimGlyphsForge';
import type { DimKey } from './types';

export type IconSetId = 'line' | 'forge' | 'concept';

/** The drawn sets. `line` is absent — it renders lucide components instead. */
export const GLYPH_SETS: Record<Exclude<IconSetId, 'line'>, Record<DimKey, () => React.ReactNode>> = {
  forge: FORGE_GLYPH,
  concept: CONCEPT_GLYPH,
};

const KEY = 'mastermind.iconSet.v1';

export function loadIconSet(): IconSetId {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'line' || v === 'forge' ? v : 'concept';
  } catch {
    // best-effort — a blocked storage never breaks the canvas
    return 'concept';
  }
}

export function saveIconSet(id: IconSetId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // best-effort — a full/blocked storage never breaks the canvas
  }
}

const IconSetContext = createContext<IconSetId>('concept');

export const IconSetProvider = IconSetContext.Provider;

export const useIconSet = (): IconSetId => useContext(IconSetContext);

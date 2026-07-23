// Which dimension glyph set the canvas paints with. Two sets ship side by side
// so the branded one can be evaluated against the baseline and reverted
// instantly if it ever degrades readability:
//   line  — lucide outline icons (the original set)
//   forge — the Mastermind-native solid set (dimGlyphsForge)
// Tool BRAND marks (Supabase, Sentry, GitHub…) render in BOTH sets — a real
// logo outranks any generic glyph; the set only decides the fallback.
// Provided by MastermindPage and read directly by the glyph renderers, so the
// choice doesn't have to be threaded through every island prop chain.
import { createContext, useContext } from 'react';

export type IconSetId = 'line' | 'forge';

const KEY = 'mastermind.iconSet.v1';

export function loadIconSet(): IconSetId {
  try {
    return localStorage.getItem(KEY) === 'line' ? 'line' : 'forge';
  } catch {
    // best-effort — a blocked storage never breaks the canvas
    return 'forge';
  }
}

export function saveIconSet(id: IconSetId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // best-effort — a full/blocked storage never breaks the canvas
  }
}

const IconSetContext = createContext<IconSetId>('forge');

export const IconSetProvider = IconSetContext.Provider;

export const useIconSet = (): IconSetId => useContext(IconSetContext);

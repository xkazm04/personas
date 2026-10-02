import { createContext, useContext } from 'react';

/**
 * The drafting sheet's theme versions (spark twin-portable-blueprint, round 2
 * WP-C): ONE renderer, four looks, from the cyanotype slab to a native
 * Personas page.
 *
 * - `cyanotype`: the baseline, Studio's blue paper (`.drafting-root`).
 * - `tint`: the same sheet, its paper and ink derived from the active theme
 *   only, its edge a Personas card (`themes/tint.css`).
 * - `surface`: no paper; the drawing is inked straight onto the app's content
 *   surface and the regions are Personas cards (`themes/surface.css`).
 * - `native`: Personas' own language (glow, gradients, status tokens, the
 *   brand glyph); drafting survives in the draw-in and the hatch
 *   (`themes/native.css`).
 *
 * Colour and shape changes live in the theme's stylesheet, scoped under
 * `[data-drafting-theme]`; this context is read only where a theme changes
 * STRUCTURE (a frame that becomes a card, lettering that becomes an eyebrow,
 * the title block, the section marks).
 */
export type DraftingTheme = 'cyanotype' | 'tint' | 'surface' | 'native';

export const DraftingThemeContext = createContext<DraftingTheme>('cyanotype');

export function useDraftingTheme(): DraftingTheme {
  return useContext(DraftingThemeContext);
}

/** The theme inks onto the app's own surface: regions are cards, there is no sheet. */
export function isPaperless(theme: DraftingTheme): boolean {
  return theme === 'surface' || theme === 'native';
}

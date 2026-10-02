import { createContext, useContext } from 'react';

/**
 * The drafting sheet's theme levels (spark twin-portable-blueprint; round 3
 * WP-D reworked round 2's three versions): ONE renderer, four looks. The
 * blueprint is the kept layer in every one of them (paper and grid, the hatch,
 * the dimension lines, the double sheet frame, the draw-in) and Personas
 * absorbs it step by step:
 *
 * - `cyanotype`: the baseline, Studio's blue paper (`.drafting-root`).
 * - `tint` ("Personas touch"): the cyanotype intact, fixed blue in every
 *   theme; Personas only as the sheet's card edge, the app's figures, and the
 *   theme's primary as the accent ink of live things (`themes/tint.css`).
 * - `surface` ("Half and half"): paper and ink half cyanotype, half theme;
 *   the regions are Personas glass cards laid on the paper, the drafting marks
 *   drawn on top of them (`themes/surface.css`).
 * - `native` ("Personas blueprint"): no foreign blue; the grid, the frames,
 *   the hatches and the dimension lines in the theme's own colour, the
 *   regions glowing Personas cards in its status roles (`themes/native.css`).
 *
 * Colour and shape changes live in the level's stylesheet, scoped under
 * `[data-drafting-theme]`; this context is read only where a level changes
 * STRUCTURE (a frame that becomes a card, a heading or a label in the app's
 * type, the title block, the section marks).
 */
export type DraftingTheme = 'cyanotype' | 'tint' | 'surface' | 'native';

export const DraftingThemeContext = createContext<DraftingTheme>('cyanotype');

export function useDraftingTheme(): DraftingTheme {
  return useContext(DraftingThemeContext);
}

/** The regions and the title block are Personas cards laid on the paper. */
export function hasCards(theme: DraftingTheme): boolean {
  return theme === 'surface' || theme === 'native';
}

/** Section names are the app's titles (labels keep the drafting lettering until `native`). */
export function appHeadings(theme: DraftingTheme): boolean {
  return theme === 'surface' || theme === 'native';
}

/** Labels are the app's eyebrows instead of drafting lettering: Personas has taken the type. */
export function appLabels(theme: DraftingTheme): boolean {
  return theme === 'native';
}

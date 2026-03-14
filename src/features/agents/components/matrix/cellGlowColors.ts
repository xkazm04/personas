/**
 * Cell glow color mapping -- maps cell keys to CSS glow color class names.
 *
 * Each class sets `--cell-glow-color` to a theme-tinted color via `color-mix`.
 * The corresponding CSS classes are defined in globals.css.
 */

// -- Cell key to glow color class mapping ------------------------------------

export const CELL_GLOW_COLOR_CLASSES: Record<string, string> = {
  "use-cases": "cell-glow-violet",
  connectors: "cell-glow-cyan",
  triggers: "cell-glow-amber",
  "human-review": "cell-glow-rose",
  messages: "cell-glow-blue",
  memory: "cell-glow-purple",
  "error-handling": "cell-glow-orange",
  events: "cell-glow-teal",
};

// -- Helper -------------------------------------------------------------------

/**
 * Returns the glow color CSS class for a given cell key.
 * Falls back to empty string for unknown keys.
 */
export function getCellGlowColorClass(cellKey: string): string {
  return CELL_GLOW_COLOR_CLASSES[cellKey] ?? "";
}

/**
 * A 0..1 axis position as an SVG percentage length. Geometry, not a displayed
 * figure: no rounding, so the browser places it at full precision.
 */
export const pct = (n: number): string => `${n * 100}%`;

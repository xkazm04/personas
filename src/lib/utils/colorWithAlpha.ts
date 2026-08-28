/** A full 3-, 6- or 8-digit hex body (no `#`). Anything else is not a hex colour. */
const HEX_BODY = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Convert a hex color + opacity (0–1) to an rgba() string.
 * Handles 3-digit (#abc), 6-digit (#aabbcc), and 8-digit (#aabbccdd) hex.
 * Falls back to the raw color string if parsing fails.
 *
 * The shape is validated BEFORE parsing, because `parseInt(s, 16)` does not
 * reject — it stops at the first invalid character. `parseInt('1z', 16)` is `1`,
 * so `'#1z2z3z'` used to yield `rgb(1,2,3)`, a near-black, instead of falling
 * back to the raw string. Colours here come from stored data (`personaColor`,
 * `teamColor`), so a corrupted value silently became a plausible-looking colour
 * rather than an obvious one.
 *
 * A non-finite `opacity` falls back to fully opaque: `Math.max`/`Math.min`
 * propagate `NaN`, and the resulting literal `rgba(r,g,b,NaN)` is invalid CSS
 * that the browser drops without a word.
 */
export function colorWithAlpha(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  if (!HEX_BODY.test(h)) return hex; // unrecognized format — return as-is

  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h.charAt(0) + h.charAt(0), 16);
    g = parseInt(h.charAt(1) + h.charAt(1), 16);
    b = parseInt(h.charAt(2) + h.charAt(2), 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }

  const a = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  return `rgba(${r},${g},${b},${a})`;
}

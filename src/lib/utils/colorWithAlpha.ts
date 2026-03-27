/**
 * Convert a hex color + opacity (0–1) to an rgba() string.
 * Handles 3-digit (#abc), 6-digit (#aabbcc), and 8-digit (#aabbccdd) hex.
 * Falls back to the raw color string if parsing fails.
 */
export function colorWithAlpha(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  let r: number, g: number, b: number;

  if (h.length === 3) {
    r = parseInt(h.charAt(0) + h.charAt(0), 16);
    g = parseInt(h.charAt(1) + h.charAt(1), 16);
    b = parseInt(h.charAt(2) + h.charAt(2), 16);
  } else if (h.length >= 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return hex; // unrecognized format — return as-is
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;

  const a = Math.max(0, Math.min(1, opacity));
  return `rgba(${r},${g},${b},${a})`;
}

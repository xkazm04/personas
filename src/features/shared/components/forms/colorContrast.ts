/**
 * WCAG contrast maths for the color picker's readability preview. Pure and
 * DOM-free apart from `readThemeColor`, which reads a CSS custom property so
 * the preview judges the color against the theme the operator is actually in.
 */

/** WCAG 2.1 AA minimum for normal-size body text. */
export const WCAG_AA_NORMAL = 4.5;

/** #rgb or #rrggbb -> [r, g, b] in 0-255, or null when it is neither. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const body = m[1]!;
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance (sRGB), 0 for black and 1 for white. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors, 1 to 21, or null if either is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the pair clears AA for normal text. Unparseable input is not a pass. */
export function meetsWcagAA(a: string, b: string): boolean {
  const ratio = contrastRatio(a, b);
  return ratio !== null && ratio >= WCAG_AA_NORMAL;
}

/**
 * Current value of a theme custom property (e.g. `--foreground`), which this
 * repo declares as a plain hex. Falls back when the property is absent or is
 * not a hex - in jsdom, in a test, or under a theme that spells it some other
 * way - so the preview degrades to a defensible default instead of throwing.
 */
export function readThemeColor(property: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  return parseHex(raw) ? raw : fallback;
}

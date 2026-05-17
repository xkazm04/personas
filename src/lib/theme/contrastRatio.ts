/**
 * WCAG contrast ratio helpers — single source of truth for theme a11y badges.
 *
 * Spec: https://www.w3.org/TR/WCAG21/#contrast-minimum
 *   L = 0.2126*R + 0.7152*G + 0.0722*B   (sRGB → relative luminance)
 *   contrast = (L_light + 0.05) / (L_dark + 0.05)   // range [1, 21]
 *
 * Levels:
 *   ≥ 7.0   AAA  (best — body text passes all sizes)
 *   ≥ 4.5   AA   (passes normal-size body text)
 *   <  4.5  low  (insufficient for normal text — needs calibration)
 */

export type ContrastLevel = 'AAA' | 'AA' | 'low';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function getContrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

export function getContrastLevel(fgHex: string, bgHex: string): ContrastLevel {
  const ratio = getContrastRatio(fgHex, bgHex);
  if (ratio >= 7.0) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'low';
}

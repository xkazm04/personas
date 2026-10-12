import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";

/** A colour at an alpha, for a dimension's hex colour AND for a theme
 *  variable (`var(--primary)`), which colorWithAlpha would pass through
 *  untouched at full strength. */
export function tint(color: string, alpha: number): string {
  if (color.startsWith("#")) return colorWithAlpha(color, alpha);
  const share = Math.round(alpha * 100);
  return `color-mix(in srgb, ${color} ${share}%, transparent)`;
}

/** What a question that belongs to no dimension is drawn in: the theme. */
export const THEME_INK = "var(--primary)";

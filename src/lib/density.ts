/**
 * Density token system for list views.
 *
 * Three modes covering the spectrum from new-user-friendly (cozy) to
 * power-user-dense (compact). Tokens are Tailwind class fragments; consumers
 * pick the slot they need (`rowPaddingY` for table rows, `cardPadding` for
 * card layouts) and concatenate into their `className`.
 */

export type Density = 'cozy' | 'comfortable' | 'compact';

export interface DensityTokens {
  /** Vertical padding for table-style rows. */
  rowPaddingY: string;
  /** Horizontal padding for table-style rows. */
  rowPaddingX: string;
  /** Vertical padding for table headers. */
  headerPaddingY: string;
  /** Single padding shorthand for card / list-item layouts. */
  cardPadding: string;
  /** Vertical gap between stacked cards. */
  cardGap: string;
  /** Default text size for cell content. */
  textClass: string;
  /** Primary icon size (e.g. row-leading icons, status icons). */
  iconClass: string;
  /** Secondary, smaller icon size for inline glyphs. */
  smallIconClass: string;
  /** Default flex/grid gap inside cells. */
  gap: string;
}

export const DENSITY_VALUES: readonly Density[] = ['cozy', 'comfortable', 'compact'];

export const DENSITY_TOKENS: Record<Density, DensityTokens> = {
  cozy: {
    rowPaddingY: 'py-3',
    rowPaddingX: 'px-4',
    headerPaddingY: 'py-3',
    cardPadding: 'p-4',
    cardGap: 'space-y-3',
    textClass: 'text-md',
    iconClass: 'w-5 h-5',
    smallIconClass: 'w-4 h-4',
    gap: 'gap-3',
  },
  comfortable: {
    rowPaddingY: 'py-2',
    rowPaddingX: 'px-4',
    headerPaddingY: 'py-2.5',
    cardPadding: 'p-3',
    cardGap: 'space-y-2',
    textClass: 'text-md',
    iconClass: 'w-4 h-4',
    smallIconClass: 'w-3.5 h-3.5',
    gap: 'gap-2.5',
  },
  compact: {
    rowPaddingY: 'py-1.5',
    rowPaddingX: 'px-3',
    headerPaddingY: 'py-1.5',
    cardPadding: 'p-2',
    cardGap: 'space-y-1.5',
    textClass: 'text-xs',
    iconClass: 'w-3.5 h-3.5',
    smallIconClass: 'w-3 h-3',
    gap: 'gap-2',
  },
};

export const DEFAULT_DENSITY: Density = 'comfortable';

export function isDensity(value: unknown): value is Density {
  return value === 'cozy' || value === 'comfortable' || value === 'compact';
}

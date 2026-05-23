import { createElement, type ElementType, type ReactNode } from 'react';
import { formatNumeric, type NumericUnit } from '@/lib/utils/formatters';

/**
 * `<Numeric>` — the canonical primitive for any number shown in the UI.
 *
 * Renders its value with **tabular (fixed-width) lining figures** so digits
 * never jitter on update and right-aligned columns stay flush. The body
 * element already opts into `tabular-nums lining-nums` globally, but routing
 * numeric surfaces through this primitive makes the intent explicit, keeps the
 * figure style local-to-the-glyph even if a parent overrides
 * `font-variant-numeric`, and — most usefully — gives every metric surface one
 * shared unit formatter (ms / s / $ / % / count) via {@link formatNumeric}.
 *
 * Two ways to supply content:
 * - **Formatted by the primitive:** pass `value` + `unit` and let
 *   {@link formatNumeric} produce the string (`<Numeric value={4200} unit="ms" />`
 *   → `"4s"`).
 * - **Pre-formatted:** pass `children` (e.g. an `<AnimatedCounter>` or an
 *   already-formatted label) and the primitive only contributes the figure
 *   style + alignment (`<Numeric align="right">{label}</Numeric>`).
 *
 * For right-aligned table cells pass `align="right"`; for a `<DataGrid>` column
 * set the column's `align: 'right'` (the cell container handles justification)
 * and use `<Numeric>` for the value.
 */
export interface NumericProps {
  /** Raw numeric value, formatted via {@link formatNumeric} unless `children` is given. */
  value?: number | null;
  /** Unit to format `value` with. Ignored when `children` is provided. */
  unit?: NumericUnit;
  /** Decimal precision passed through to the unit formatter. */
  precision?: number;
  /** BCP-47 locale for separators (default `'en'`). Pass `i18n.language` for locale-aware grouping. */
  language?: string;
  /** Pre-formatted content. When set, `value`/`unit`/`precision` are ignored. */
  children?: ReactNode;
  /** `'right'` adds `text-align: right` for numeric columns. */
  align?: 'left' | 'right';
  /** Extra classes appended after the figure-style class. */
  className?: string;
  /** Render element. Defaults to `<span>`. */
  as?: ElementType;
  /** Native `title` tooltip (e.g. full-precision value on a truncated display). */
  title?: string;
}

export function Numeric({
  value,
  unit = 'plain',
  precision,
  language,
  children,
  align = 'left',
  className,
  as,
  title,
}: NumericProps) {
  const tag: ElementType = as ?? 'span';
  const content =
    children ?? formatNumeric(value, unit, { precision, language });

  return createElement(
    tag,
    {
      className: `font-data${align === 'right' ? ' text-right' : ''}${className ? ` ${className}` : ''}`,
      // Inline guarantee: keep tabular+lining figures even if an ancestor
      // resets font-variant-numeric. `.font-data` carries the matching
      // font-feature-settings (tnum/lnum) for browsers honoring those.
      style: { fontVariantNumeric: 'tabular-nums lining-nums' },
      title,
    },
    content,
  );
}

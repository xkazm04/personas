import { createElement, type ElementType, type ReactNode } from 'react';
import { formatNumeric, formatCount, type NumericUnit } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

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
  /**
   * BCP-47 locale override for separators. **Defaults to the active UI
   * language** — you almost never need to pass this.
   *
   * It used to default to `'en'`, and callers were instructed to pass
   * `useTranslation().language` themselves. Measured 2026-08-14: of 197
   * value-driven call sites, **8 passed it**. So 189 (95.9%) rendered
   * en-US separators in a 14-locale app, seven of whose locales use a decimal
   * comma — `1.50` where `1,50` is correct. `custom/prefer-numeric` could not
   * catch it: the rule verifies you REACHED this primitive and cannot verify
   * you CONFIGURED it, which made it a gate pointing at a broken destination.
   * Binding the default here fixes every call site at once and leaves the prop
   * as a genuine override (e.g. rendering a fixed-locale export preview).
   */
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
  // Bind the locale here rather than requiring every caller to. `useTranslation`
  // returns a stable identity per language, so this adds no re-render churn, and
  // 57 other shared components already consume it.
  const { language: activeLanguage } = useTranslation();
  const locale = language ?? activeLanguage;
  const content =
    children ?? formatNumeric(value, unit, { precision, language: locale });

  // For compact-notation figures, default the tooltip to the full-precision
  // grouped value so the exact number is always one hover away — unless the
  // caller supplied an explicit title or its own pre-formatted children.
  const resolvedTitle =
    title ??
    (children == null && unit === 'compact' && value != null && !Number.isNaN(value)
      ? formatCount(value, { language: locale, precision: 0 })
      : undefined);

  return createElement(
    tag,
    {
      className: `font-data${align === 'right' ? ' text-right' : ''}${className ? ` ${className}` : ''}`,
      // Inline guarantee: keep tabular+lining figures even if an ancestor
      // resets font-variant-numeric. `.font-data` carries the matching
      // font-feature-settings (tnum/lnum) for browsers honoring those.
      style: { fontVariantNumeric: 'tabular-nums lining-nums' },
      title: resolvedTitle,
    },
    content,
  );
}

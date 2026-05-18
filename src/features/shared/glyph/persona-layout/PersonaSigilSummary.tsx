import type { ReactNode } from 'react';
import { GLYPH_DIMENSIONS, DIM_META } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';

/**
 * One row in the summary — caller-translated label + caller-rendered value.
 * `value` is a ReactNode so callers can return text, icon lists, or inline
 * status pills without the sidebar imposing a shape.
 */
export interface PersonaSigilSummaryEntry {
  label: string;
  value: ReactNode;
}

interface PersonaSigilSummaryProps {
  /** Caller-supplied summary for each dim. Missing dims are hidden when
   *  `hideEmpty` is true (default); otherwise rendered with a muted "—". */
  entries: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>>;

  /** Optional heading above the list. Pass `null` to hide the heading. */
  heading?: string | null;

  /** When true (default) only dims with an entry are rendered. When false
   *  every dim row shows, with a muted dash placeholder for empties. */
  hideEmpty?: boolean;
}

/**
 * Left-side companion to the Persona Sigil — a compact, color-coded
 * summary of the saved values for each dimension (Apps, When, Memory,
 * …). Lives in `leftSlot` of `PersonaLayout`.
 *
 * Each row renders:
 *   - the dim's Lucide icon, tinted with the dim's brand color
 *   - the dim label (caller-supplied so it can be i18n'd in the right
 *     section without coupling this shared component to any one section)
 *   - the resolved value (text or richer ReactNode — caller decides)
 *
 * The component is data-shaped, not state-shaped: it doesn't reach into
 * useCases or build sessions itself. Each mode (view / adoption / scratch)
 * derives the right values from its own state and passes them in. That
 * keeps the surface mode-agnostic and easy to test.
 */
export function PersonaSigilSummary({
  entries,
  heading,
  hideEmpty = true,
}: PersonaSigilSummaryProps) {
  const rows = GLYPH_DIMENSIONS
    .map((dim) => ({ dim, entry: entries[dim] ?? null }))
    .filter(({ entry }) => (hideEmpty ? entry !== null : true));

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {heading !== null && heading !== undefined && (
        <span className="typo-label uppercase tracking-[0.18em] text-foreground/55 px-1">
          {heading}
        </span>
      )}
      <ul className="flex flex-col gap-2.5">
        {rows.map(({ dim, entry }) => {
          const meta = DIM_META[dim];
          const Icon = meta.icon;
          return (
            <li
              key={dim}
              className="flex items-start gap-2.5 px-2 py-2 rounded-card bg-secondary/20 border border-card-border"
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.colorClass}`} aria-hidden />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className={`typo-label uppercase tracking-wider ${meta.colorClass}`}>
                  {entry?.label ?? dim}
                </span>
                <span className="typo-caption text-foreground/80 break-words">
                  {entry?.value ?? <span className="text-foreground/35">—</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import type { ReactNode } from 'react';
import { GLYPH_DIMENSIONS, DIM_META } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';

/**
 * One row in the summary. The label is no longer rendered — the sidebar
 * shows icon + value only per the 2026-05-17 design pass — but callers
 * still pass it so the field is available to title attributes / future
 * tooltip work without an API break.
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
 * Left-side companion to the Persona Sigil — a colour-coded, dim-by-dim
 * summary of the saved values. Lives in `leftSlot` of `PersonaLayout`.
 *
 * Each row pairs the dim's Lucide icon (tinted in the dim's brand
 * colour) with the resolved value (text or richer ReactNode). The dim
 * label is intentionally hidden — the icon + colour already identify
 * the dimension, and dropping the redundant label gives the value room
 * to breathe at body-large type.
 *
 * The label survives on the entry shape so the row carries a hover
 * tooltip identifying the dim by name — that keeps the surface
 * accessible even when the icon alone isn't familiar to the user.
 *
 * The component is data-shaped (entries map), not state-shaped: each
 * mode (view / adoption / scratch) derives the right values from its
 * own state and passes them in. That keeps the surface mode-agnostic.
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
        <span className="typo-label uppercase tracking-[0.18em] text-foreground px-1">
          {heading}
        </span>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map(({ dim, entry }) => {
          const meta = DIM_META[dim];
          const Icon = meta.icon;
          return (
            <li
              key={dim}
              title={entry?.label ?? dim}
              className="group relative flex items-center gap-3 px-3 py-3 rounded-card bg-secondary/15 border border-card-border/50 hover:border-card-border transition-colors overflow-hidden"
              style={{
                // Soft halo in the dim's colour fading from the leading
                // edge — echoes the sigil petals' "lit from inside" feel
                // without competing with the value text. Static (no
                // hover dependence) so the row reads as identity, not
                // interactive affordance.
                background:
                  `radial-gradient(ellipse 80% 120% at 0% 50%, ${meta.color}1a 0%, transparent 65%), ` +
                  `linear-gradient(90deg, ${meta.color}08 0%, transparent 100%)`,
              }}
            >
              {/* Leading colour bar — 2px stripe in the dim's colour,
                  reinforcing the per-row identity without taking width. */}
              <span
                aria-hidden
                className="absolute left-0 top-0 bottom-0 w-[2px]"
                style={{ backgroundColor: meta.color, opacity: 0.7 }}
              />
              <Icon className={`w-5 h-5 shrink-0 ${meta.colorClass}`} />
              <span
                className={`typo-body-lg leading-snug min-w-0 break-words ${meta.colorClass}`}
                style={{ filter: 'brightness(1.1)' }}
              >
                {entry?.value ?? <span className="opacity-40">—</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

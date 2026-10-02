import DrawFrame from './draw/DrawFrame';
import { isPaperless, useDraftingTheme } from './draftingTheme';

/**
 * The sheet's border, 8px in from the paper's edge where Studio's sheet draws
 * it as an outline (twinDrafting.css removes that outline so this one can be
 * drawn): the first frame a plan traces. It sits in the sheet's content box,
 * which the variant's root insets 20px, hence -12px. `draw` false: the sheet
 * is already drawn (a zoom keeps the border it was drawn with).
 *
 * Round 2 WP-C: the tinted sheet keeps it (rounded by tint.css to sit inside
 * its card edge); the inked page and the native version have no sheet, so no
 * border.
 */
export default function SheetBorder({ draw = true }: { draw?: boolean }) {
  const theme = useDraftingTheme();
  if (isPaperless(theme)) return null;
  return (
    <div aria-hidden className="twd-sheet-border pointer-events-none absolute -inset-3">
      <DrawFrame stroke="var(--ink-dim)" edge={0} draw={draw} />
    </div>
  );
}

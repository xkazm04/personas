import DrawFrame from './draw/DrawFrame';

/**
 * The sheet's border, 8px in from the paper's edge where Studio's sheet draws
 * it as an outline (twinDrafting.css removes that outline so this one can be
 * drawn): the first frame a plan traces. It sits in the sheet's content box,
 * which the variant's root insets 20px, hence -12px. `draw` false: the sheet
 * is already drawn (a zoom keeps the border it was drawn with).
 */
export default function SheetBorder({ draw = true }: { draw?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute -inset-3">
      <DrawFrame stroke="var(--ink-dim)" edge={0} draw={draw} />
    </div>
  );
}

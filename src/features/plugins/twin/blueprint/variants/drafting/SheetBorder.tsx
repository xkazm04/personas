import DrawFrame from './draw/DrawFrame';

/**
 * The sheet's border, the outer line of the drawing's double frame (the
 * paper's inner edge is the other) and the first frame a plan traces. It sits
 * in the sheet's content box, which the root insets 16px, hence -8px: 8px in
 * from the sheet's card edge, its corners rounded to run round the card's
 * (sheet.css). `draw` false: the sheet is already drawn (a zoom keeps the
 * border it was drawn with).
 */
export default function SheetBorder({ draw = true }: { draw?: boolean }) {
  return (
    <div aria-hidden className="twd-sheet-border pointer-events-none absolute -inset-2">
      <DrawFrame stroke="var(--ink-dim)" edge={0} draw={draw} />
    </div>
  );
}

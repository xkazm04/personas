// SessionDivider — the rule between a column's roster and its live sessions.
//
// It is a ROW of the column rather than a wrapper around the sessions (see
// `gridGeometry.columnRows` for why: two lists sharing one scroller is exactly
// the offset arithmetic that module exists to avoid), and it is emitted only
// when the column HAS sessions — an empty divider would read as "this team has
// a session lane and it is empty", which is a different claim.
//
// IT IS A HAIRLINE, NOT A CAPTION. It read "Live Claude Sessions" until
// 2026-09-07 — a label naming a distinction the eye has already made, since a
// session tile is shorter, hollow and dashed against a solid persona tile. On a
// board of twenty columns that word was printed twenty times, on the surface's
// scarcest axis, to say what the shape below it already said.
//
// The word survives for assistive tech, where the shape argument does not
// reach: `sr-only`, not deleted.

export function SessionDivider({ label }: { label: string }) {
  return (
    <span className="flex h-full items-end pb-1" data-testid="fleet-grid-session-strip">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="h-px w-full bg-border" />
    </span>
  );
}

export default SessionDivider;

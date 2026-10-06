// Reserved space for the two lazy slots at the edges of the Activity frame.
//
// A panel that pops in and reflows the board is a defect, so the frame is
// complete from its first commit: the desk's column already holds its width
// and its border, the supply column already holds the usage plate's block.
// The SAME element is what the beat replaces and what Suspense would fall back
// to, so neither admission nor a slow chunk can move a pixel of the chrome.
//
// These are the panels at rest, in the geometry the data lands in — never a
// spinner, never a shimmer (`Ghosts.tsx` holds the board's equivalent).

/** Shut, the desk is exactly as wide as three figures need. Shared with the
 *  desk itself so the reserved column and the real one cannot drift. */
export const DESK_REST_WIDTH = 108;

/** The desk before its beat: the shut dock's column, header bar and figures. */
export function DeskGhost() {
  return (
    <div className="flex min-h-0 flex-shrink-0" aria-hidden data-testid="entry-e-desk-ghost">
      <div
        className="flex min-h-0 min-w-0 flex-col border-l border-border"
        style={{ width: DESK_REST_WIDTH }}
      >
        <div className="h-9 flex-shrink-0 border-b border-border" />
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
          {[0, 1, 2].map((i) => <span key={i} className="ae-ghost h-[54px] rounded-input" />)}
        </div>
      </div>
    </div>
  );
}

/** The usage plates before their beat: one plate of the column's width. */
export function UsageGhost() {
  return (
    <div className="ae-plate flex flex-col gap-2 rounded-card p-3" aria-hidden data-testid="entry-e-usage-ghost">
      <span className="ae-ghost h-3 w-20 rounded-input" />
      <span className="ae-ghost h-10 rounded-input" />
      <span className="ae-ghost h-10 rounded-input" />
    </div>
  );
}

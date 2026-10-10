// Reserved space for the two lazy slots at the edges of the Activity frame.
//
// A panel that pops in and reflows the board is a defect, so the frame is
// complete from its first commit: the supply column already holds the usage plate's block.
// The SAME element is what the beat replaces and what Suspense would fall back
// to, so neither admission nor a slow chunk can move a pixel of the chrome.
//
// These are the panels at rest, in the geometry the data lands in — never a
// spinner, never a shimmer (`Ghosts.tsx` holds the board's equivalent).

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

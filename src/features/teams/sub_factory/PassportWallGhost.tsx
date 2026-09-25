// The calm delayed ghost of the passport WALL (loading choreography v2,
// docs/design/overview-loading.md), moved out of ProjectsLayer at Gate 5 so the
// layer stays under 200 lines. It mirrors the wall's own geometry, which is
// out of the kit port's scope (the wall is its own surface), so it keeps its
// literal widths and inline tints. // style-deviation: wall geometry, Gate 5.
// ---------------------------------------------------------------------------
// PassportWallGhost — calm delayed ghost of the passport WALL (loading
// choreography v2, docs/design/overview-loading.md). Cold loads (no cached
// snapshot yet — see usePassportData's module-scope cachedSnapshot) show this
// instead of a whole-region spinner; warm remounts skip it entirely since
// `loading` is already false.
//
// Geometry mirrors WallCompareTable, which is the wall's ONLY view since the
// Overview grid was removed (2026-08-27): the bordered matrix shell, a sticky
// 190px label rail, and N 236px cover columns above a band of dimension rows.
// It used to mirror the grid's 2/3-column tiles, so it ghosted a shape the
// settled render could no longer produce — the one way a ghost lies.
//
// `animate-fade-in` + a >=120ms staggered delay keeps it invisible on a fast
// load (law 3); no `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Cover columns drawn. Four is what fits a desk window before the matrix
 *  scrolls horizontally — past that the ghost would draw off-screen. */
const GHOST_COL_COUNT = 4;
/** Dimension rows drawn under the covers. Enough to read as a matrix; the real
 *  table has ~40 and ghosting all of them is paint nobody sees. */
const GHOST_ROW_COUNT = 6;

/** The compare table's own rail/column widths — kept literal here rather than
 *  imported, because these are the ghost's geometry contract and a shared
 *  constant would invite the table to change them without a ghost to match. */
const GHOST_RAIL = 'w-[190px] min-w-[190px]';
const GHOST_COL = 'w-[236px] min-w-[236px]';

export function PassportWallGhost() {
  const cols = Array.from({ length: GHOST_COL_COUNT });
  return (
    <div
      className="overflow-hidden rounded-modal border border-primary/[0.08] bg-secondary/[0.03] shadow-elevation-1"
      aria-hidden="true"
    >
      {/* cover header band — one silhouette per project column */}
      <div className="flex border-b-2 border-primary/15">
        <div className={`${GHOST_RAIL} px-3 py-3`}>
          <span className={`block h-2.5 w-16 ${GHOST_BAR}`} />
        </div>
        {cols.map((_, i) => (
          <div
            key={i}
            className={`${GHOST_COL} animate-fade-in border-l border-primary/[0.08] px-3 py-3`}
            style={{ borderTop: '2px solid rgba(148,163,184,.14)', animationDelay: `${120 + i * 35}ms` }}
          >
            {/* identity row: status dot + name + stack strip */}
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary/[0.10]" />
              <span className={`h-3.5 w-20 ${GHOST_BAR}`} />
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {Array.from({ length: 3 }).map((__, j) => (
                  <span key={j} className="h-3.5 w-3.5 rounded-[3px] bg-primary/[0.05]" />
                ))}
              </span>
            </div>
            {/* statband: 5 labeled cells */}
            <div
              className="mt-2.5 flex items-center justify-between rounded-card px-2.5 py-1.5"
              style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.10)' }}
            >
              {Array.from({ length: 5 }).map((__, j) => (
                <span key={j} className="flex min-w-0 flex-col items-center gap-1">
                  <span className={`h-2.5 w-5 ${GHOST_BAR}`} />
                  <span className="h-1.5 w-4 rounded bg-primary/[0.04]" />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* dimension rows — a section band, then labelled rows across the columns */}
      <div className="animate-fade-in" style={{ animationDelay: '260ms' }}>
        <div className="border-t border-primary/10 bg-primary/[0.03] px-3 py-1.5">
          <span className={`block h-2.5 w-24 ${GHOST_BAR}`} />
        </div>
        {Array.from({ length: GHOST_ROW_COUNT }).map((_, r) => (
          <div key={r} className="flex border-t border-primary/[0.06]">
            <div className={`${GHOST_RAIL} px-3 py-2`}>
              <span className={`block h-2.5 w-28 ${GHOST_BAR}`} />
            </div>
            {cols.map((__, i) => (
              <div key={i} className={`${GHOST_COL} border-l border-primary/[0.08] px-3 py-2`}>
                <span className="block h-2.5 w-16 rounded bg-primary/[0.04]" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

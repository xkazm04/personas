/**
 * Shape-matched shimmer placeholder for Lab result views (summary band +
 * model-performance card row + ghost scenario table) shown while results
 * hydrate, so the layout lands before data and never jumps.
 *
 * Mirrors the geometry of `ArenaResultsView` / `EvalResultsGrid`: an executive
 * summary band, a row of up to three model-performance cards (header chip,
 * composite-score block, three score bars, cost/duration foot), and a ghost
 * scenario-breakdown table. Placeholder bars use the same
 * `bg-primary/10 animate-pulse` treatment as `ListSkeleton` /
 * `ContentHeaderSkeleton` so every loading surface reads as one family.
 *
 * Render it as the `LabTab` Suspense fallback (panel-chunk hydration) and in
 * the result views while `fetchResults` is in flight, in place of the bare
 * centered caption / `no_results` text. **If you restyle the real result
 * layout, nudge this twin so the swap stays jump-free.**
 */
interface LabResultsSkeletonProps {
  /** Number of model/version performance cards. Clamped to 1–3 (Arena's max). Default 3. */
  cards?: number;
  /** Number of ghost table body rows. Default 5. */
  rows?: number;
  className?: string;
}

// Shared placeholder-bar treatment — matches ListSkeleton / ContentHeaderSkeleton.
const BAR = 'rounded bg-primary/10 animate-pulse';

export function LabResultsSkeleton({ cards = 3, rows = 5, className }: LabResultsSkeletonProps) {
  const cardCount = Math.max(1, Math.min(cards, 3));
  return (
    <div
      className={`space-y-6 ${className ?? ''}`}
      aria-hidden="true"
      data-testid="lab-results-skeleton"
    >
      {/* Executive summary band */}
      <div className="rounded-modal border border-primary/10 bg-gradient-to-br from-secondary/40 to-background/20 overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-card bg-primary/10 animate-pulse flex-shrink-0" />
            <div className="space-y-1.5">
              <span className={`block h-3.5 w-32 ${BAR}`} />
              <span className={`block h-3 w-44 ${BAR}`} />
            </div>
          </div>
          <span className={`block h-3 w-[90%] ${BAR}`} />
        </div>
      </div>

      {/* Model-performance card row */}
      <div className="space-y-3">
        <span className={`block h-3 w-40 ${BAR}`} />
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cardCount}, 1fr)` }}>
          {Array.from({ length: cardCount }).map((_, i) => (
            <div key={i} className="rounded-modal border border-primary/10 overflow-hidden">
              {/* Card header */}
              <div className="px-4 py-3 bg-secondary/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-5 w-6 ${BAR}`} />
                  <span className={`h-4 w-20 ${BAR}`} />
                </div>
                <span className="h-4 w-12 rounded-full bg-primary/10 animate-pulse" />
              </div>

              {/* Score section */}
              <div className="px-4 py-3 space-y-3 bg-background/40">
                {/* Big composite score */}
                <div className="flex items-center gap-3 p-3 rounded-card bg-primary/5">
                  <span className="h-9 w-12 rounded bg-primary/15 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <span className={`block h-3 w-16 ${BAR}`} />
                    <span className={`block h-2.5 w-24 ${BAR}`} />
                  </div>
                </div>

                {/* Score bars */}
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={`h-2.5 w-20 ${BAR}`} />
                        <span className={`h-2.5 w-8 ${BAR}`} />
                      </div>
                      <span className="block h-1.5 w-full rounded-full bg-primary/10 animate-pulse" />
                    </div>
                  ))}
                </div>

                {/* Cost & duration foot */}
                <div className="flex items-center gap-3 pt-1 border-t border-primary/5">
                  <span className={`h-2.5 w-14 ${BAR}`} />
                  <span className={`h-2.5 w-14 ${BAR}`} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ghost scenario-breakdown table */}
      <div className="space-y-3">
        <span className={`block h-3 w-40 ${BAR}`} />
        <div className="overflow-hidden border border-primary/10 rounded-modal">
          {/* Header row */}
          <div className="flex items-center gap-3 px-3 py-2.5 border-b border-primary/10 bg-secondary/20">
            <span className={`h-2.5 flex-1 ${BAR}`} />
            {Array.from({ length: cardCount }).map((_, i) => (
              <span key={i} className={`h-2.5 w-16 flex-shrink-0 ${BAR}`} />
            ))}
          </div>
          {/* Body rows */}
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-3 border-b border-primary/[0.06] last:border-b-0 ${
                i % 2 === 1 ? 'bg-secondary/10' : ''
              }`}
            >
              <span className={`h-3 flex-1 max-w-[200px] ${BAR}`} />
              {Array.from({ length: cardCount }).map((_, j) => (
                <span key={j} className="h-8 w-16 flex-shrink-0 rounded-card bg-primary/10 animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

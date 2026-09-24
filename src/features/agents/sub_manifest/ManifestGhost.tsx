/**
 * Calm geometry-matched ghost UNDER the permanent chrome — never a spinner,
 * and never in place of the header (loading pattern v2, law 1).
 *
 * Its geometry now matches the document surface it stands in for: a rail
 * column beside a stack of prose lines, so the first paint after the fetch
 * lands does not move the page.
 */
export function ManifestGhost() {
  return (
    <div className="flex gap-4" aria-hidden data-testid="manifest-ghost">
      <div className="hidden w-52 shrink-0 space-y-1 md:block">
        {[0, 1, 2, 3, 4].map((b) => (
          <div
            key={b}
            className="rounded-input bg-secondary/20 animate-pulse"
            style={{ height: `${[18, 10, 12, 34, 22][b]}%`, minHeight: '2.75rem' }}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-5">
        <div className="h-7 w-72 rounded-input bg-secondary/30 animate-pulse" />
        <div className="max-w-[70ch] space-y-2">
          <div className="h-4 w-40 rounded-input bg-secondary/30 animate-pulse" />
          {[0, 1, 2, 3, 4].map((l) => (
            <div key={l} className="h-3 rounded-input bg-secondary/20 animate-pulse" />
          ))}
        </div>
        <div className="space-y-1.5">
          {[0, 1, 2].map((r) => (
            <div key={r} className="h-10 rounded-card bg-secondary/20 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

// Cold-load ghost for the charter (docs/design/overview-loading.md): the folio's
// two pages at the real article geometry, under the permanent part heads, shown
// only when nothing is cached yet. Each article fades in after ~120ms, so a fast
// fetch never paints it; no pulse.
const PAGES = [4, 6];

export function CharterGhost() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8" aria-hidden data-testid="lc-journey-ghost">
      {PAGES.map((count, page) => (
        <div key={page} className="space-y-3">
          <span className="block h-3 w-28 rounded-interactive bg-primary/[0.06]" />
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="border-l-2 border-l-primary/15 pl-4 py-3 space-y-2 animate-fade-in"
              style={{ animationDelay: `${120 + (page * 4 + i) * 30}ms` }}
            >
              <span className="block h-4 w-32 rounded-interactive bg-primary/[0.06]" />
              <span className="block h-3 w-full rounded-interactive bg-primary/[0.04]" />
              <span className="block h-3 w-3/5 rounded-interactive bg-primary/[0.04]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Cold states. A panel that has not read its fleet yet shows the panel at rest:
// plates and dark lines in the geometry the data will land in, never a spinner
// and never a shimmer. An empty panel says so through the shared
// ScenarioEmptyState at its call site, and when a filter emptied it, offers the
// one click that undoes the filter.

const BAY_SHAPES = [4, 2, 3, 1, 2, 3, 1, 2];

/**
 * One line at rest, in the geometry every bay row lands in (WP11 C,
 * `LineParts.tsx`): 36px, the 24px face, the name, the lamp at the right edge.
 */
export function LineGhost() {
  return (
    <span className="flex h-9 items-center gap-1.5 pl-2 pr-2.5">
      <span className="ae-ghost h-6 w-6 flex-shrink-0 rounded-input" />
      <span className="ae-ghost h-3 w-28 rounded-input" />
      <span className="ae-ghost ml-auto h-2.5 w-2.5 flex-shrink-0 rounded-full" />
    </span>
  );
}

export function BayGhosts() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3" aria-hidden data-testid="entry-e-ghost">
      <div className="ae-bays">
        {BAY_SHAPES.map((n, i) => (
          <div key={i} className="ae-plate flex flex-col rounded-card pb-1">
            <span className="ae-ghost mx-2.5 my-2 h-6 rounded-input" />
            {Array.from({ length: n }, (_, j) => <LineGhost key={j} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SocketGhosts({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }} aria-hidden>
      {Array.from({ length: count }, (_, i) => <span key={i} className="ae-ghost h-[64px] rounded-card" />)}
    </div>
  );
}

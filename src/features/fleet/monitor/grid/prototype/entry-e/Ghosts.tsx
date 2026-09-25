// Cold states. A panel that has not read its fleet yet shows the panel at rest:
// plates and dark windows in the geometry the data will land in, never a
// spinner and never a shimmer. (An empty panel says so through the shared
// ScenarioEmptyState, at its call site.)

const BAY_SHAPES = [4, 2, 3, 1, 2, 3, 1, 2];

export function BayGhosts() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3" aria-hidden data-testid="entry-e-ghost">
      <div className="grid items-start gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(218px, 1fr))' }}>
        {BAY_SHAPES.map((n, i) => (
          <div key={i} className="ae-plate flex flex-col gap-1.5 rounded-card p-2">
            <span className="ae-ghost h-8 rounded-input" />
            {Array.from({ length: n }, (_, j) => <span key={j} className="ae-ghost h-9 rounded-input" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SocketGhosts({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }} aria-hidden>
      {Array.from({ length: count }, (_, i) => <span key={i} className="ae-ghost h-[68px] rounded-card" />)}
    </div>
  );
}

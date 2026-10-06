/**
 * A quiet stand-in for the Monitor's fleet floor under the strip, so the
 * screenshots read in context. Deliberately inert and low-contrast.
 */
const TILES = Array.from({ length: 24 }, (_, i) => i);

export function FleetFloor() {
  return (
    <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3 overflow-hidden p-4" aria-hidden>
      {TILES.map((i) => (
        <div key={i} className="flex h-24 flex-col gap-2 rounded-card border border-primary/10 bg-secondary/15 p-3">
          <div className="flex items-center gap-2">
            <span className="h-5 w-5 rounded-pill bg-primary/10" />
            <span className="h-2 w-24 rounded-pill bg-primary/10" />
          </div>
          <span className="h-2 w-3/4 rounded-pill bg-primary/5" />
          <span className="h-2 w-1/2 rounded-pill bg-primary/5" />
        </div>
      ))}
    </div>
  );
}

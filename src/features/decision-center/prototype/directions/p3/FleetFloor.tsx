/** A quiet stand-in for the Monitor's fleet floor, so the strip reads in context. */
export function FleetFloor() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-4" aria-hidden>
      <div className="p3-floor">
        {Array.from({ length: 24 }, (_, i) => <div key={i} />)}
      </div>
    </div>
  );
}

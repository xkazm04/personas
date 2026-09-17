// Geometry-matched ghost for the Strategic map (docs/design/overview-loading.md
// v2): three lane silhouettes at the real lane's dimensions. It paints ONLY
// into emptiness — a refetch over existing lanes never shows it — and each row
// is invisible for its first ≥150ms, so a fast read never flashes one.
const GHOST_BAR = 'rounded bg-primary/[0.06]';
const DELAYS = ['150ms', '185ms', '220ms'];

export function StrategicMapGhost() {
  return (
    <div className="space-y-1.5" data-testid="kpi-map-ghost" aria-hidden="true">
      {DELAYS.map((delay) => (
        <div key={delay} className="flex items-center gap-1.5 animate-fade-in" style={{ animationDelay: delay }}>
          <span className={`w-[200px] h-4 shrink-0 ${GHOST_BAR}`} />
          <span className={`w-16 h-3 shrink-0 ${GHOST_BAR}`} />
          <div className="flex items-center gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={`w-[132px] h-10 shrink-0 ${GHOST_BAR}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

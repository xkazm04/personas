// Cold-load ghost for the journey (docs/design/overview-loading.md): the two
// lane shapes at the real geometry, under the permanent header, shown only
// when nothing is cached yet. Each node fades in after ~120ms, so a fast fetch
// never paints it; no pulse.
const LANES = [4, 6];

export function JourneyGhost() {
  return (
    <div className="flex w-max mx-auto items-start gap-8 px-2" aria-hidden data-testid="lc-journey-ghost">
      {LANES.map((count, lane) => (
        <div key={lane} className="flex flex-col gap-3">
          <span className="h-5 w-28 rounded-interactive bg-primary/[0.06]" />
          <div className="flex items-start gap-2">
            {Array.from({ length: count }).map((_, i) => (
              <div
                key={i}
                className="w-20 flex flex-col items-center gap-2 animate-fade-in"
                style={{ animationDelay: `${120 + (lane * 4 + i) * 30}ms` }}
              >
                <span className="w-11 h-11 rounded-modal bg-primary/[0.06]" />
                <span className="h-3.5 w-12 rounded-interactive bg-primary/[0.06]" />
                <span className="h-1.5 w-14 rounded-interactive bg-primary/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

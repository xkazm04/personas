// Cold-load ghost for the crosscheck grid (docs/design/overview-loading.md):
// the two lane groups at the real row geometry under the plate's permanent head,
// shown only when nothing is cached yet. Each row fades in after ~120ms, so a
// fast fetch never paints it; no pulse.
const LANES = [4, 6];

export function CrosscheckGhost() {
  return (
    <div aria-hidden data-testid="lc-journey-ghost">
      {LANES.map((count, lane) => (
        <div key={lane}>
          <div className="h-6 px-2 flex items-center">
            <span className="h-3 w-28 rounded-interactive bg-primary/[0.06]" />
          </div>
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[9.5rem_1fr_4rem] items-center gap-x-3 h-7 px-2 animate-fade-in"
              style={{ animationDelay: `${120 + (lane * 4 + i) * 30}ms` }}
            >
              <span className="h-3.5 w-24 rounded-interactive bg-primary/[0.06]" />
              <span className="h-4 w-full max-w-[16rem] rounded-interactive bg-primary/[0.04]" />
              <span className="h-3.5 w-8 rounded-interactive bg-primary/[0.06] justify-self-end" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

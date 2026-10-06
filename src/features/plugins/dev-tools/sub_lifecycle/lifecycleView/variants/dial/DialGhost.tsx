// Cold-load ghost for the dial (docs/design/overview-loading.md): the crown's
// own geometry - the hub circle and ten blank arcs at the real radius - under
// the plate's permanent head, shown only when nothing is cached yet. Each arc
// fades in after ~120ms, so a fast fetch never paints it; no pulse.
import { HUB_R, RING_R, SIZE, arcPath } from './dial.model';

const STEPS = 10;

export function DialGhost() {
  const slot = 360 / STEPS;
  return (
    <div className="relative w-[22rem] h-[22rem] mx-auto" aria-hidden data-testid="lc-journey-ghost">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 w-full h-full">
        {Array.from({ length: STEPS }).map((_, i) => (
          <path
            key={i}
            d={arcPath(RING_R, i * slot + 2, (i + 1) * slot - 2)}
            fill="none"
            strokeWidth={9}
            className="stroke-primary/[0.08] animate-fade-in"
            style={{ animationDelay: `${120 + i * 30}ms` }}
          />
        ))}
      </svg>
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/10"
        style={{ width: HUB_R * 2, height: HUB_R * 2 }}
      />
    </div>
  );
}

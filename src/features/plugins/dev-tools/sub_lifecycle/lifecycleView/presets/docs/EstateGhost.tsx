// The estate while the step's detail is first read: the share card and the
// folder tray at their real geometry, holding calm ghost folders, so the swap
// to data moves nothing above the list.
import { Ghost } from '@/features/shared/components/kit';

import { lcSurface, RHYTHM } from '../../system/lcSurface';
import { GhostLine } from '../../system/GhostLine';

/** Folder widths (flex grow) of the ghost: a few large, a few small, as an estate usually is. */
const FOLDERS = [5, 3, 3, 2, 2, 1];

export function EstateGhost() {
  return (
    <div className="flex flex-wrap items-start gap-4" aria-hidden data-testid="lcx7-estate-ghost">
      <div className={`flex w-full shrink-0 flex-col ${RHYTHM.tight} ${lcSurface('card')} sm:w-72`}>
        <GhostLine role="eyebrow" width="40%" />
        <GhostLine role="stat" width="55%" />
        <GhostLine role="row" width="70%" />
        <Ghost width="100%" height="0.625rem" />
        <GhostLine role="meta" width="50%" />
      </div>
      <div className={`flex min-w-0 flex-1 flex-wrap gap-3 ${lcSurface('panel')}`}>
        {FOLDERS.map((grow, i) => (
          <div key={i} className={`flex min-w-0 flex-col gap-2 ${lcSurface('card')}`} style={{ flex: `${grow} 1 12rem` }}>
            <GhostLine role="title" width="60%" />
            <GhostLine role="meta" width="35%" />
            <Ghost width="100%" height={`${1.5 + grow * 0.5}rem`} />
          </div>
        ))}
      </div>
    </div>
  );
}

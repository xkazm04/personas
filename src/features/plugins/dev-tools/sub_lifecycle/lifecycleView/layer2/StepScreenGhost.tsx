// Layer 2's chunk ghosts (docs/design/overview-loading.md §D), drawn from the
// real screen's shells: `StepScreenGhost` is the trail row, the hero band (a
// `panel` holding a large key, the title / reason / meta lines and an
// instrument-sized disc) and
// one preset section; `PresetGhost` is that section alone, for a screen whose
// header is already up while its preset chunk loads. Both are invisible for
// their first 150ms, so a prefetched chunk never paints them. No pulse.
import { Ghost, GhostRows } from '@/features/shared/components/kit';

import { GhostLine } from '../system/GhostLine';
import { RHYTHM, lcShape, lcSurface } from '../system/lcSurface';
import { GAUGE, KEY } from '../system/scales';

const LATE = { animationDelay: '150ms' } as const;

export function PresetGhost() {
  return (
    <div className={`animate-fade-in ${RHYTHM.block}`} style={LATE} aria-hidden data-testid="lc2-preset-ghost">
      <div className={RHYTHM.tight}>
        <GhostLine role="title" width="10rem" />
        <GhostLine role="meta" width="28rem" />
      </div>
      <GhostRows count={3} size="l" />
    </div>
  );
}

export function StepScreenGhost() {
  const disc = GAUGE.lg.size;
  return (
    <div className={`animate-fade-in ${RHYTHM.section}`} style={LATE} aria-hidden data-testid="lc2-ghost">
      <div className={RHYTHM.block}>
        <div className="flex h-8 items-center justify-between gap-3">
          <Ghost width="9rem" height="1.25rem" />
          <Ghost width="11rem" height="2rem" />
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-x-10 gap-y-6 ${lcSurface('panel')}`}>
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <span className={`block shrink-0 overflow-hidden ${KEY.lg} ${lcShape('card')}`}><Ghost width="100%" height="100%" /></span>
            <div className={`min-w-0 flex-1 ${RHYTHM.tight}`}>
              <GhostLine role="pageTitle" width="12rem" />
              <GhostLine role="lead" width="24rem" />
              <GhostLine role="meta" width="10rem" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="block overflow-hidden rounded-full" style={{ width: disc, height: disc }}><Ghost width="100%" height="100%" /></span>
            <GhostLine role="label" width="5rem" />
          </div>
        </div>
      </div>
      <PresetGhost />
    </div>
  );
}

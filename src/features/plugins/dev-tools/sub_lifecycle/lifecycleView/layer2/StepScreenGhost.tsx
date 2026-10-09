// Layer 2's chunk ghosts (docs/design/overview-loading.md §D), drawn from the
// real screen's shells: `StepScreenGhost` is the mini-map row (the way back and
// ten pins), the band (a `band` holding a large key, the title / reason / meta
// lines and the instrument: a dial beside a hero figure) and one preset
// section; `PresetGhost` is that section alone, for a screen whose band is
// already up while its preset chunk loads. Both are invisible for their first
// 150ms, so a prefetched chunk never paints them. No pulse.
import { Ghost, GhostRows } from '@/features/shared/components/kit';

import { GhostLine } from '../system/GhostLine';
import { RHYTHM, lcShape, lcSurface } from '../system/lcSurface';
import { GAUGE, KEY } from '../system/scales';

const LATE = { animationDelay: '150ms' } as const;
const PINS = 10;

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
  const dial = GAUGE.sm.size;
  return (
    <div className={`animate-fade-in ${RHYTHM.section}`} style={LATE} aria-hidden data-testid="lc2-ghost">
      <div className={RHYTHM.block}>
        <div className="flex h-9 items-center gap-5">
          <Ghost width="7rem" height="2rem" />
          <span className="flex items-center gap-2.5">
            {Array.from({ length: PINS }, (_, i) => (
              <span key={i} className={`block h-9 w-12 overflow-hidden ${lcShape('pin')}`}><Ghost width="100%" height="100%" /></span>
            ))}
          </span>
        </div>
        <div className={`flex items-center justify-between gap-8 ${lcSurface('band')}`}>
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className={`block shrink-0 overflow-hidden ${KEY.lg} ${lcShape('card')}`}><Ghost width="100%" height="100%" /></span>
            <div className={`min-w-0 flex-1 ${RHYTHM.tight}`}>
              <GhostLine role="pageTitle" width="12rem" />
              <GhostLine role="lead" width="22rem" />
              <GhostLine role="meta" width="16rem" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="block overflow-hidden rounded-full" style={{ width: dial, height: dial }}><Ghost width="100%" height="100%" /></span>
            <div className={RHYTHM.tight}>
              <GhostLine role="hero" width="5rem" />
              <GhostLine role="label" width="6rem" />
            </div>
          </div>
        </div>
      </div>
      <PresetGhost />
    </div>
  );
}

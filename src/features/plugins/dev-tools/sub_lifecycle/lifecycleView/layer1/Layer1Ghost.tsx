// Layer 1's cold-load ghost (docs/design/overview-loading.md §C), drawn from
// the SAME shells as the real layer - the status band's class, the `Lane`
// tray and its columns, a card of the same five rows (`rail/cardRows`) per
// step, every text line one line of its real type role tall (`GhostLine`) -
// so the swap to data moves nothing. Shown only into emptiness (no cached
// snapshot), under the permanent header; invisible for its first 150ms, so a
// warm or fast load never paints it. No pulse.
import type { CSSProperties } from 'react';

import { Ghost } from '@/features/shared/components/kit';

import { GhostLine } from '../system/GhostLine';
import { RAIL, lcShape, lcSurface } from '../system/lcSurface';
import { KEY, METER } from '../system/scales';
import { CARD_ROW, CARD_ROW_GAP, lineSlot } from './rail/cardRows';
import { Lane } from './rail/Lane';
import { STATUS_BAND } from './status/StatusBand';

/** The default practice's two lanes (before / after the task): the likeliest geometry. */
const LANES = [4, 6] as const;

const delay = (ms: number) => ({ '--ghost-delay': `${150 + ms}ms` }) as CSSProperties;

function GhostCard({ i }: { i: number }) {
  return (
    <div className={`flex min-w-0 flex-col ${CARD_ROW_GAP} ${lcSurface('node', 'border-2 border-primary/10')}`} style={delay(i * 35)}>
      <div className={CARD_ROW.head}>
        <span className={`block shrink-0 overflow-hidden ${KEY.sm} ${lcShape('card')}`}><Ghost width="100%" height="100%" /></span>
        <GhostLine role="title" width="55%" />
      </div>
      <div className={CARD_ROW.figure}>
        <GhostLine role="stat" width="3.2rem" />
        <span className="flex flex-col items-end">
          <span className={lineSlot('delta')} />
          <GhostLine role="metaNum" width="2.6rem" />
        </span>
      </div>
      <div className={CARD_ROW.meter}>
        <span className={`block w-full overflow-hidden rounded-pill ${METER.track}`}><Ghost width="100%" height="100%" /></span>
      </div>
      <div className={CARD_ROW.label}><GhostLine role="label" width="60%" /></div>
      <div className={CARD_ROW.verdict}><GhostLine role="label" width="45%" /></div>
    </div>
  );
}

export function Layer1Ghost() {
  return (
    <div className={`animate-fade-in ${RAIL.laneGap}`} style={{ animationDelay: '150ms' }} aria-hidden data-testid="lc1-ghost">
      <div className={STATUS_BAND}>
        <div className="min-w-0 flex-[1_1_22rem]"><GhostLine role="row" width="70%" /></div>
        <span className="block h-9 w-[34rem] max-w-full"><Ghost width="100%" height="100%" /></span>
      </div>
      {LANES.map((n, lane) => (
        <Lane
          key={lane}
          as="div"
          head={<GhostLine role="eyebrow" width="7rem" />}
          count={<Ghost width="1.5rem" height="1.25rem" />}
          steps={n}
          testId={`lc1-ghost-lane-${lane}`}
        >
          {Array.from({ length: n }, (_, i) => <GhostCard key={i} i={lane * 4 + i} />)}
        </Lane>
      ))}
    </div>
  );
}

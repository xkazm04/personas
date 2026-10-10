// The history figure's ghost (docs/design/overview-loading.md): the same three
// columns and the same named row heights as the figure, so the swap to data
// moves nothing. Invisible for its first 150ms, so a warm or idle-fast read
// never paints it. No pulse. `HistoryBody` holds it at the figure's height.
import { Ghost } from '@/features/shared/components/kit';

import { GhostLine } from '../system/GhostLine';
import { lcShape } from '../system/lcSurface';
import { HIST_LABEL_COL, HIST_ROW, HIST_ROW_GAP, HIST_SCALE_COL } from './historyGeometry';

const ROWS = [HIST_ROW.verdict, HIST_ROW.verdict, HIST_ROW.duration, HIST_ROW.coverage] as const;

export function HistoryGhost() {
  return (
    <div className="animate-fade-in" style={{ animationDelay: '150ms' }} aria-hidden data-testid="lc-history-ghost">
      <div className="flex h-7 items-center"><GhostLine role="row" width="45%" /></div>
      <div className="mt-2 grid items-start gap-x-3" style={{ gridTemplateColumns: `${HIST_LABEL_COL} minmax(0, 1fr) ${HIST_SCALE_COL}` }}>
        <div className={`flex flex-col ${HIST_ROW_GAP}`}>
          {ROWS.map((h, i) => <span key={i} className={`flex items-center ${h}`}><GhostLine role="label" width="70%" /></span>)}
        </div>
        <div className={`flex flex-col ${HIST_ROW_GAP}`}>
          {ROWS.map((h, i) => (
            <span key={i} className={`block overflow-hidden ${h} ${lcShape('chip')}`}><Ghost width="100%" height="100%" /></span>
          ))}
          <span className={`mt-1 flex items-start justify-between ${HIST_ROW.axis}`}>
            <GhostLine role="meta" width="5rem" />
            <GhostLine role="label" width="3.5rem" />
          </span>
        </div>
        <span />
      </div>
    </div>
  );
}

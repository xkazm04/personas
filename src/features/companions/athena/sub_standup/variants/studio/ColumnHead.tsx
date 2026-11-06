import { memo } from 'react';

import type { Zoom } from '../../model/keymap';
import { TickLabels, type Axes } from './axis';
import { Key } from './controls';
import { STUDIO_COPY } from './copy';

/**
 * The sticky column head: a quiet title over each column, and the hour numerals
 * drawn ONCE for the two time columns (mono, tabular). The NOW pill sits on the
 * Tonight axis while the plan runs; every row draws its gridlines at these ticks.
 */
export const ColumnHead = memo(function ColumnHead({ axes, zoom }: { axes: Axes; zoom: Zoom }) {
  const c = STUDIO_COPY.col;
  return (
    <div className="ss-colhead ss-grid" role="presentation">
      <div className="ss-cell ss-c1 ss-ch"><span className="ss-ch__t">{c.name}</span></div>
      <div className="ss-cell ss-c2 ss-ch ss-ch--axis">
        <span className="ss-ch__t">{zoom === 'today' ? c.today : c.today_long}<Key>Z</Key></span>
        <TickLabels ticks={axes.todayTicks} />
      </div>
      <div className="ss-cell ss-c3 ss-ch"><span className="ss-ch__t">{c.decision}</span></div>
      <div className="ss-cell ss-c4 ss-ch ss-ch--axis">
        <span className="ss-ch__t">{c.tonight}</span>
        <TickLabels ticks={axes.nightTicks} nowPos={axes.nowPos} nowLabel={axes.nowLabel} />
      </div>
    </div>
  );
});

import { memo } from 'react';

import type { Zoom } from '../../model/keymap';
import { Kbd } from '../../parts/Kbd';
import { TickLabels, type Axes } from './axis';
import { ED_COPY } from './copy';

/**
 * The one sticky column head, closed by a strong rule: small-caps titles, and the hour numerals
 * (tabular) drawn ONCE for the two time columns. Every row below rules its hours at these positions.
 */
export const ColumnHead = memo(function ColumnHead({ axes, zoom }: { axes: Axes; zoom: Zoom }) {
  const c = ED_COPY.col;
  return (
    <div className="se-colhead se-grid" role="presentation">
      <div className="se-cell se-c1 se-ch"><span className="se-sc">{c.name}</span></div>
      <div className="se-cell se-c2 se-ch">
        <span className="se-ch__title">
          <span className="se-sc">{zoom === 'today' ? c.today : c.today_long}</span>
          <Kbd>Z</Kbd>
        </span>
        <TickLabels ticks={axes.todayTicks} />
      </div>
      <div className="se-cell se-c3 se-ch"><span className="se-sc">{c.decision}</span></div>
      <div className="se-cell se-c4 se-ch">
        <span className="se-ch__title"><span className="se-sc">{c.tonight}</span></span>
        <TickLabels ticks={axes.nightTicks} />
      </div>
    </div>
  );
});

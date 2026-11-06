import { memo } from 'react';

import type { Zoom } from '../../model/keymap';
import { Kbd } from '../../parts/Kbd';
import { TickLabels, type Axes } from './axis';
import { LEDGER_COPY } from './copy';

/**
 * The one sticky header row: a column title over each column, and the hour
 * numerals drawn ONCE for the two time columns. Every row below draws its
 * gridlines at these same positions.
 */
export const ColumnHead = memo(function ColumnHead({ axes, zoom }: { axes: Axes; zoom: Zoom }) {
  const c = LEDGER_COPY.col;
  return (
    <div className="sl-colhead sl-grid" role="presentation">
      <div className="sl-cell sl-c1 sl-ch"><span className="typo-caption">{c.name}</span></div>
      <div className="sl-cell sl-c2 sl-ch sl-ch--axis">
        <span className="sl-ch__title">
          <span className="typo-caption">{zoom === 'today' ? c.today : c.today_long}</span>
          <Kbd>Z</Kbd>
        </span>
        <TickLabels ticks={axes.todayTicks} />
      </div>
      <div className="sl-cell sl-c3 sl-ch"><span className="typo-caption">{c.decision}</span></div>
      <div className="sl-cell sl-c4 sl-ch sl-ch--axis">
        <span className="sl-ch__title"><span className="typo-caption">{c.tonight}</span></span>
        <TickLabels ticks={axes.nightTicks} />
      </div>
    </div>
  );
});

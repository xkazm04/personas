import { memo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Zoom } from '../model/keymap';
import { TickLabels, type Axes } from './axis';
import { Key } from './prims';

/**
 * The one sticky header row: a mono micro label over each column and the hour
 * numerals drawn ONCE for the two time columns, each on a hairline tick that
 * the rows below continue. Once the plan runs, the clock rides the night axis
 * as a sharp readout tag over the NOW stroke.
 */
export const ColumnHead = memo(function ColumnHead({ axes, zoom, clock }: { axes: Axes; zoom: Zoom; clock: string }) {
  const { t } = useTranslation();
  const c = t.athena.standup.console.col;
  return (
    <div className="sc-colhead sc-grid" role="presentation">
      <div className="sc-cell sc-c1 sc-ch"><span className="sc-micro">{c.name}</span></div>
      <div className="sc-cell sc-c2 sc-ch sc-ch--axis">
        <span className="sc-ch__title">
          <span className="sc-micro">{zoom === 'today' ? c.today : c.today_long}</span>
          <Key>Z</Key>
        </span>
        <TickLabels ticks={axes.todayTicks} />
      </div>
      <div className="sc-cell sc-c3 sc-ch"><span className="sc-micro">{c.decision}</span></div>
      <div className="sc-cell sc-c4 sc-ch sc-ch--axis">
        <span className="sc-ch__title"><span className="sc-micro">{c.tonight}</span></span>
        <TickLabels ticks={axes.nightTicks} now={axes.nowPos != null ? { pos: axes.nowPos, label: clock } : null} />
      </div>
    </div>
  );
});

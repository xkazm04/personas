// A rail card's verdict line while a Measure measures its step: the gauge
// glyph and "Measuring", with how many of the step's commands are done once
// the plan is known ("Measuring, 1 of 3"; a narrow card says "Measuring" and
// keeps the count for when it has room, as the was-verdict does). It takes the verdict row's place
// at the verdict row's height, so the card does not move. The figure above
// keeps the reading from before the Measure until its last run lands.
import { Gauge } from 'lucide-react';

import { useLifecycleViewModel } from '../../context';
import type { Tally } from '../../measure/measureModel';
import { GLYPH } from '../../system/scales';
import { CARD_ROW } from './cardRows';

export function MeasuringVerdict({ tally }: { tally: Tally }) {
  const { dl, tx } = useLifecycleViewModel();
  return (
    <div className={`${CARD_ROW.verdict} text-primary`} data-row="verdict" data-measuring="true">
      <Gauge className={`${GLYPH.sm} shrink-0`} aria-hidden />
      {tally.total > 0 ? (
        <>
          <span className="min-w-0 truncate @[11.5rem]/card:hidden">{dl.lcx4_card_measuring}</span>
          <span className="hidden min-w-0 truncate @[11.5rem]/card:inline">
            {tx(dl.lcx4_card_measuring_count, { done: tally.done, total: tally.total })}
          </span>
        </>
      ) : (
        <span className="min-w-0 truncate">{dl.lcx4_card_measuring}</span>
      )}
    </div>
  );
}

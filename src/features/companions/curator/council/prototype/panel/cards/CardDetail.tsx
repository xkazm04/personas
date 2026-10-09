// PROTOTYPE ROUND (spark council-readout), direction B. What the selected
// scorecard opens to, in place: the council's own one-line reading of the
// round (`whyLine`, the sentence the round table says), then two figures - how
// many things must be addressed, and the member holding the round down.
import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { whyLine } from '../../../table/councilCopy';
import type { Seat } from '../../../table/runModel';
import { usePercent } from '../../../table/usePercent';
import type { PanelRow } from '../../protoModel';
import { S, weakestSeat } from './cardsModel';

export function CardDetail({ row, seats }: { row: PanelRow; seats: Seat[] }) {
  const { t, tx, language } = useTranslation();
  const percent = usePercent();
  const s = row.subject;
  const why = whyLine(seats, s.overall, s.coverage, row.rubric, percent);
  const weak = weakestSeat(seats);

  return (
    <div className="sc-detail">
      <p className="m-0 typo-body text-foreground">{tx(t.council.table[why.key], why.values)}</p>
      <div className="sc-figs">
        <div className="sc-fig">
          <span className={`typo-data-lg ${row.mustAddress ? 'text-status-warning' : 'text-foreground'}`}>
            {formatCount(row.mustAddress ?? 0, { language })}
          </span>
          <span className="typo-label text-muted">{S.toAddress}</span>
        </div>
        <div className="sc-fig grow">
          {weak ? (
            <span className="sc-weak">
              <span className="typo-heading text-foreground sc-weak-name">{weak.name}</span>
              <span className={`typo-data-lg ${weak.floorHit ? 'text-status-error' : 'text-foreground'}`}>
                {weak.score == null ? '-' : formatCount(weak.score, { precision: 2, language })}
              </span>
            </span>
          ) : (
            <span className="typo-heading text-muted">{S.weakestNone}</span>
          )}
          <span className="typo-label text-muted">{weak?.floorHit ? S.floorHit : S.weakest}</span>
        </div>
      </div>
      {row.liteOnly ? <p className="m-0 typo-caption">{S.liteNote}</p> : null}
    </div>
  );
}

export default CardDetail;

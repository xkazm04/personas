// PROTOTYPE ROUND (spark council-readout), direction A. The selected account
// opened into its sub-accounts: one line per member, its name, its own bar on
// the shared 0..1 scale (bar tick and floor notch where they fall, the notch
// and the figure red when the floor is hit), and its score as a figure. A
// member nobody measured says so in words.
import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { Seat } from '../../../table/runModel';
import { S } from './ledgerModel';

const pct = (ratio: number) => `${Math.max(0, Math.min(1, ratio)) * 100}%`;

export function LedgerBreakdown({ seats, threshold, lite }: { seats: Seat[]; threshold: number; lite: boolean }) {
  const { language } = useTranslation();
  const n = (v: number) => formatCount(v, { precision: 2, language });
  return (
    <ul className={`lg-sub${lite ? ' lite' : ''}`}>
      {seats.map((seat) => (
        <li key={seat.name} className="lg-sub-row">
          <span className="typo-body text-foreground lg-sub-name">{seat.name}</span>
          <span className={`lg-sub-track${seat.score == null ? ' nm' : ''}${seat.floorHit ? ' hit' : ''}`} aria-hidden="true">
            {seat.score != null ? <i className="lg-fill" style={{ width: pct(seat.score) }} /> : null}
            {seat.floor != null ? (
              <b className={`lg-floor${seat.advisory ? ' adv' : ''}`} style={{ left: pct(seat.floor) }} />
            ) : null}
            <em className="lg-tick" style={{ left: pct(threshold) }} />
          </span>
          {seat.score == null ? (
            <span className="typo-label text-muted lg-sub-fig">{S.notMeasured}</span>
          ) : (
            <span className={`typo-data lg-sub-fig ${seat.floorHit ? 'text-status-error' : 'text-foreground'}`}>
              {n(seat.score)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default LedgerBreakdown;

// PROTOTYPE ROUND (spark council-readout), direction A. The ledger head's two
// small pieces under the account totals: the one sentence the uncalibrated
// instrument owes every row (led by the same tick the rows draw at the bar),
// and a key drawn with the same marks the rows use.
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import type { QueueFilter } from '../../protoModel';
import { PROTO } from '../../protoStrings';
import { S } from './ledgerModel';

/** One account total as a tab label: the count is the figure, the name sits under it. */
export function LedgerTotal({ id, count }: { id: QueueFilter; count: number }) {
  const { language } = useTranslation();
  return (
    <span className="lg-total">
      <span className={`typo-data-lg ${id === 'waiting' && count ? 'text-status-warning' : 'text-foreground'}`}>
        {formatCount(count, { language })}
      </span>
      <span className="typo-label text-foreground">{PROTO.filter[id]}</span>
    </span>
  );
}

export function LedgerKey({ threshold }: { threshold: number }) {
  const { language } = useTranslation();
  return (
    <>
      <p className="m-0 typo-caption lg-key-item">
        <i aria-hidden="true" className="lg-key-tick" />
        {tx(S.advisory, { threshold: formatCount(threshold, { precision: 2, language }) })}
      </p>
      <div className="lg-key typo-label text-muted" aria-hidden="true">
        <span className="lg-key-item">
          <i className="lg-key-segs">
            <b />
            <b />
            <b />
          </i>
          {S.legendMembers}
        </span>
        <span className="lg-key-item">
          <i className="lg-key-floor" />
          {S.legendFloor}
        </span>
        <span className="lg-key-item">
          <i className="lg-key-cov" />
          {S.legendCoverage}
        </span>
      </div>
    </>
  );
}

export default LedgerKey;

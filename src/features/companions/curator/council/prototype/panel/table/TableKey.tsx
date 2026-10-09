// PROTOTYPE ROUND (spark council-readout), direction C. The one-line key
// under the table, for the marks the heads do not already name ("Measured"
// names the band, "Overall" the bar and its figure). While the council is
// uncalibrated the tick says it is ADVISORY in its own name - it only orders
// the queue and sinks nothing - so "below the bar" stays honest without a
// red list.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

const S = {
  bar: 'Bar {n}',
  advisoryBar: 'Advisory bar {n}',
  advisoryTip: 'The council is uncalibrated: the bar only orders the queue. Nothing below it is sunk.',
  notMeasured: 'Not measured',
  members: 'Member score',
  unmeasured: 'Unmeasured',
  floor: 'Below floor',
};

export function TableKey({ threshold, uncalibrated }: { threshold: number; uncalibrated: boolean }) {
  const { language } = useTranslation();
  const n = formatCount(threshold, { precision: 2, language });
  const bar = (
    <span className="bt-key__item">
      <i className="bt-sw bt-sw--tick" aria-hidden="true" />
      {tx(uncalibrated ? S.advisoryBar : S.bar, { n })}
    </span>
  );
  return (
    <footer className="bt-key typo-body">
      {uncalibrated ? <Tooltip content={<span className="typo-body">{S.advisoryTip}</span>}>{bar}</Tooltip> : bar}
      <span className="bt-key__item">
        <i className="bt-sw bt-sw--hatch" aria-hidden="true" />
        {S.notMeasured}
      </span>
      <span className="bt-key__item bt-key__ramp">
        <span className="bt-ramp" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((s) => (
            <i key={s} className={`bt-dot r${s}`} />
          ))}
        </span>
        {S.members}
      </span>
      <span className="bt-key__item">
        <i className="bt-dot is-unmeasured" aria-hidden="true" />
        {S.unmeasured}
      </span>
      <span className="bt-key__item">
        <i className="bt-dot r2 is-floor" aria-hidden="true" />
        {S.floor}
      </span>
    </footer>
  );
}

export default TableKey;

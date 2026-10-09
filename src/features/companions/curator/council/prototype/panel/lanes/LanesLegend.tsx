// PROTOTYPE ROUND (spark council-readout), direction D. The heatmap's two
// keys. The HEAD rides on top of the scroller on the lanes' own columns: the
// ramp in the title slot (the advisory bar drawn between its steps), each
// member's short name over its cell column, "Overall" over the figures. The
// FOOT names the three marks a cell can wear besides its colour.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { MEMBER_SHORT, memberName, RAMP_EDGES } from './laneModel';

const S = {
  ramp: 'Score',
  bar: 'bar {n}',
  barTip: 'Steps right of the tick are at or above the bar ({n}). The council is uncalibrated: the bar only orders the queue.',
  overall: 'Overall',
  notMeasured: 'Not measured',
  floor: 'Below floor',
  lite: 'Lite round only',
  liteMark: 'lite',
};

export function LanesHead({ members, threshold }: { members: string[]; threshold: number }) {
  const { language } = useTranslation();
  const n = formatCount(threshold, { precision: 2, language });
  // The tick sits after the last step whose lower edge is under the bar.
  const tickAfter = RAMP_EDGES.filter((e) => e < threshold).length;
  return (
    <div className="ln-colhead typo-body" aria-hidden="true">
      <Tooltip content={<span className="typo-body">{tx(S.barTip, { n })}</span>}>
        <span className="ln-ramp">
          <span className="ln-ramp__label">{S.ramp}</span>
          {[0, 1, 2, 3, 4].map((step) => (
            <span key={step} className="ln-ramp__step">
              <i className={`ln-sw r${step}`} />
              {step === tickAfter && <i className="ln-ramp__tick" />}
            </span>
          ))}
          <span className="ln-ramp__label">{tx(S.bar, { n })}</span>
        </span>
      </Tooltip>
      {members.map((m) => (
        <span key={m} className="ln-colhead__m">
          {MEMBER_SHORT[m] ?? memberName(m)}
        </span>
      ))}
      <span className="ln-colhead__o">{S.overall}</span>
    </div>
  );
}

export function LanesKey() {
  return (
    <footer className="ln-key typo-body">
      <span className="ln-key__item">
        <i className="ln-sw is-hatch" aria-hidden="true" />
        {S.notMeasured}
      </span>
      <span className="ln-key__item">
        <i className="ln-sw r2 is-floor" aria-hidden="true" />
        {S.floor}
      </span>
      <span className="ln-key__item">
        <span className="ln-lite" aria-hidden="true">
          {S.liteMark}
        </span>
        {S.lite}
      </span>
    </footer>
  );
}

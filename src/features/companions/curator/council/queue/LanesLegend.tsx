// The heatmap's two keys. The HEAD rides on top of the scroller on the
// lanes' own columns: the ramp in the title slot (the advisory bar drawn
// between its steps), each member's short name over its cell column,
// "Overall" over the figures. The FOOT names the three marks a cell can wear
// besides its colour.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { RAMP_EDGES } from './laneModel';

/** A member's column head: a short word that fits a heat cell. */
function useShortName(): (member: string) => string {
  const { t } = useTranslation();
  const w = t.council.lanes;
  return (member: string) => {
    switch (member) {
      case 'value':
        return w.short_value;
      case 'craft':
        return w.short_craft;
      case 'rivalry':
        return w.short_rivalry;
      case 'robustness':
        return w.short_robustness;
      case 'economics':
        return w.short_economics;
      case 'reversibility':
        return w.short_reversibility;
      default:
        return member;
    }
  };
}

export function LanesHead({ members, threshold }: { members: string[]; threshold: number }) {
  const { t, tx, language } = useTranslation();
  const w = t.council.lanes;
  const short = useShortName();
  const n = formatCount(threshold, { precision: 2, language });
  // The tick sits after the last step whose lower edge is under the bar.
  const tickAfter = RAMP_EDGES.filter((e) => e < threshold).length;
  return (
    <div className="ln-colhead typo-body" aria-hidden="true">
      <Tooltip content={<span className="typo-body">{tx(w.bar_tip, { n })}</span>}>
        <span className="ln-ramp">
          <span className="ln-ramp__label">{w.ramp}</span>
          {[0, 1, 2, 3, 4].map((step) => (
            <span key={step} className="ln-ramp__step">
              <i className={`ln-sw r${step}`} />
              {step === tickAfter && <i className="ln-ramp__tick" />}
            </span>
          ))}
          <span className="ln-ramp__label">{tx(w.bar, { n })}</span>
        </span>
      </Tooltip>
      {members.map((m) => (
        <span key={m} className="ln-colhead__m">
          {short(m)}
        </span>
      ))}
      <span className="ln-colhead__o">{w.overall}</span>
    </div>
  );
}

export function LanesKey() {
  const { t } = useTranslation();
  const w = t.council.lanes;
  return (
    <footer className="ln-key typo-body">
      <span className="ln-key__item">
        <i className="ln-sw is-hatch" aria-hidden="true" />
        {w.key_not_measured}
      </span>
      <span className="ln-key__item">
        <i className="ln-sw r2 is-floor" aria-hidden="true" />
        {w.key_floor}
      </span>
      <span className="ln-key__item">
        <span className="ln-lite" aria-hidden="true">
          {w.lite}
        </span>
        {w.key_lite}
      </span>
    </footer>
  );
}

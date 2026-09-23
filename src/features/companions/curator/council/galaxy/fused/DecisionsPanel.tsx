// Top right: what waits on the person. Each decision by its full name (never
// truncated), its project and round, how many stars it lands on and its
// overall score; a score the council never measured says "not measured" in
// words. A click lights its stars through the council focus the classic
// stage uses; `W` cycles them. Over the lens on a narrow stage, below the
// sky, the panel folds to its pulsing count and opens under the pointer or
// keyboard focus, so it does not sit on the glass.
import type { RefObject } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { useCouncilStore } from '../../councilStore';
import type { Decision } from './fusedModel';
import { useFusedStrings } from './fusedStrings';

interface Props {
  decisions: Decision[];
  fold: boolean;
  beaconRef: RefObject<HTMLElement | null>;
}

export function DecisionsPanel({ decisions, fold, beaconRef }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const focus = useCouncilStore((st) => st.focus);
  const focusCouncil = useCouncilStore((st) => st.focusCouncil);
  const clearCouncilFocus = useCouncilStore((st) => st.clearCouncilFocus);
  const lit = focus.kind === 'council' ? focus.subjectId : null;
  const count = decisions.length;

  return (
    <section ref={beaconRef} className={`fz-beacon${fold ? ' fold' : ''}`} aria-label={f.beacon_label} data-role="hud-beacon">
      <div className="b-head" tabIndex={fold ? 0 : undefined}>
        <div className="b-num" data-role="hud-beacon-number">
          {s.n(count)}
        </div>
        <div>
          <div className="b-title" data-role="hud-beacon-title">
            {count === 1 ? f.beacon_title_one : f.beacon_title_other}
          </div>
          <div className="b-sub">{f.beacon_sub}</div>
        </div>
        <kbd>W</kbd>
      </div>
      {decisions.map((d) => {
        const on = lit === d.subject.id;
        const meta = tx(f.decision_meta, {
          project: d.subject.projectName,
          round: d.subject.roundNo ?? f.not_measured,
          stars: s.n(d.stars.length),
        });
        return (
          <button
            key={d.subject.id}
            className={`dec${on ? ' on' : ''}`}
            type="button"
            data-role="hud-decision"
            aria-pressed={on}
            onClick={() => (on ? clearCouncilFocus() : focusCouncil(d.subject, null))}
          >
            <span className="dt">{d.subject.title}</span>
            <span className="ds">
              {d.subject.overall == null ? (
                <b className="nmv">{f.not_measured}</b>
              ) : (
                <b>{formatCount(d.subject.overall, { precision: 2 })}</b>
              )}
              {f.decision_overall}
            </span>
            <span className="dm">
              {meta}
              {d.missing ? ` · ${tx(f.decision_missing, { count: d.missing })}` : ''}
            </span>
          </button>
        );
      })}
    </section>
  );
}

export default DecisionsPanel;

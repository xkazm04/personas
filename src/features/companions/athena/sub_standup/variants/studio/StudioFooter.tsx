import { memo } from 'react';
import { Keyboard, Lock, Rocket } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { BusyAction } from '../../data/types';
import type { StandupView } from '../../model/types';
import { Btn } from './controls';
import { fill, STUDIO_COPY } from './copy';
import { StatePill } from './StatePill';

const LEGEND = ['proposed', 'decided', 'running', 'waits'] as const;

/** The state legend behind the help press: the four badges themselves, then the key hint. */
function Legend() {
  return (
    <span className="ss-legend">
      {LEGEND.map((k) => <StatePill key={k} row={{ state: k }} />)}
      <span className="ss-legend__keys">{STUDIO_COPY.footer.help_keys}</span>
    </span>
  );
}

interface Props {
  view: StandupView;
  rules: AwayRules | null;
  busy: Partial<Record<BusyAction, boolean>>;
  onRules: () => void;
  onKeys: () => void;
  onArm: () => void;
  onAmend: () => void;
  onEnd: () => void;
}

/** A floating action bar: away rules + help | the plan in one line | the go-press. */
export const StudioFooter = memo(function StudioFooter({ view, rules, busy, onRules, onKeys, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  const f = STUDIO_COPY.footer;
  const c = view.counts;
  const plan = view.plannedDirections > 0 ? fill(f.plan, { d: view.plannedDirections, r: view.plannedRuns }) : f.plan_none;
  // With no standup open the empty state carries the one press; an empty floating bar would be chrome for nothing.
  if (view.life === 'none') return null;
  return (
    <footer className="ss-foot">
      <div className="ss-foot__bar">
        {rules && (
          <Tooltip content={fill(f.rules_hint, { n: rules.park.length })} placement="top">
            <Btn icon={<Lock className="ss-ico" />} onClick={onRules} k="R">
              {f.rules}<span className="ss-count-badge">{rules.park.length}</span>
            </Btn>
          </Tooltip>
        )}
        <Tooltip content={<Legend />} placement="top">
          <Btn variant="quiet" className="ss-btn--icon" onClick={onKeys} aria-label={f.help} icon={<Keyboard className="ss-ico" />} />
        </Tooltip>
        <p className="ss-foot__plan">
          <span className="ss-foot__plan-main">{plan}</span>
          <span className={`ss-foot__plan-sub ${c.proposed > 0 ? 'is-open' : ''}`}>
            {c.proposed > 0 ? fill(f.still, { n: c.proposed }) : f.resolved}
          </span>
        </p>
        <span className="ss-foot__go">
          {view.life === 'decide' && (
            <Btn variant="hero" k="G" icon={<Rocket className="ss-ico" />} loading={busy.arm} onClick={onArm} data-testid="standup-arm">
              {tx(s.arm, { n: view.revision })}
            </Btn>
          )}
          {(view.life === 'armed' || view.life === 'return') && (
            <>
              <Btn variant="quiet" loading={busy.end} onClick={onEnd}>{s.end}</Btn>
              <Btn variant="hero" k="N" loading={busy.open} onClick={onAmend}>{tx(s.amend, { n: view.revision + 1 })}</Btn>
            </>
          )}
        </span>
      </div>
    </footer>
  );
});

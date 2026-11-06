import { memo } from 'react';
import { Keyboard, Lock } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { BusyAction } from '../../data/types';
import type { StandupView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { StateMark } from './StateMark';
import { ED_COPY, fill } from './copy';

const LEGEND = ['proposed', 'decided', 'running', 'done', 'skipped', 'waits'] as const;

/** The legend behind the help press: each state's own mark, so the tip teaches the page's vocabulary. */
function Legend() {
  return (
    <span className="se-legend">
      {LEGEND.map((k) => <StateMark key={k} row={{ state: k }} />)}
      <span className="se-body">{ED_COPY.footer.help_keys}</span>
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

/** The colophon: away rules and help as quiet text presses, the plan in one serif sentence, then the one solid control. */
export const EditorialFooter = memo(function EditorialFooter({ view, rules, busy, onRules, onKeys, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  const f = ED_COPY.footer;
  const c = view.counts;
  const plan = view.plannedDirections > 0 ? fill(f.plan, { d: view.plannedDirections, r: view.plannedRuns }) : f.plan_none;
  return (
    <footer className="se-foot">
      {rules && (
        <Button variant="ghost" size="sm" className="se-quietbtn" onClick={onRules} icon={<Lock className="w-4 h-4" />}>
          {fill(f.rules, { n: rules.park.length })}
        </Button>
      )}
      <Tooltip content={<Legend />} placement="top">
        <Button variant="ghost" size="sm" className="se-quietbtn" onClick={onKeys} aria-label={f.help} icon={<Keyboard className="w-4 h-4" />}>
          <span className="se-wide">{f.help}</span>
        </Button>
      </Tooltip>
      {view.life !== 'none' && (
        <p className="se-foot__plan">
          <span className="se-serif">{plan}</span>
          <span className="se-body se-wide">{c.proposed > 0 ? fill(f.still, { n: c.proposed }) : f.resolved}</span>
        </p>
      )}
      <span className="se-foot__go">
        {view.life === 'decide' && (
          <Button variant="primary" size="md" className="se-arm" loading={busy.arm} onClick={onArm} icon={<Kbd>G</Kbd>} data-testid="standup-arm">
            {tx(s.arm, { n: view.revision })}
          </Button>
        )}
        {(view.life === 'armed' || view.life === 'return') && (
          <>
            <Button variant="ghost" size="sm" className="se-quietbtn" loading={busy.end} onClick={onEnd}>{s.end}</Button>
            <Button variant="secondary" size="md" className="se-amend" loading={busy.open} onClick={onAmend} icon={<Kbd>N</Kbd>}>
              {tx(s.amend, { n: view.revision + 1 })}
            </Button>
          </>
        )}
      </span>
    </footer>
  );
});

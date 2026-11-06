import { memo } from 'react';
import { Keyboard } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { BusyAction } from '../data/types';
import type { StandupView } from '../model/types';
import { Kbd } from './Kbd';
import { useRuleLabels } from './ruleLabels';

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

const LEGEND = ['proposed', 'decided', 'running', 'waits'] as const;

/** B/1's foot: the away rules in one line, the legend, and the go-gate (Arm rev N). */
export const StandupFooter = memo(function StandupFooter({ view, rules, busy, onRules, onKeys, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  const label = useRuleLabels();
  const c = view.counts;
  return (
    <footer className="su-foot">
      {rules && (
        <div className="su-rules">
          <Button variant="ghost" size="sm" onClick={onRules} icon={<Kbd>R</Kbd>}>{s.away_rules}</Button>
          {rules.park.map((k) => <span key={k} className="su-chip su-chip--lock su-wide typo-label text-foreground">{label(k)}</span>)}
          <span className="su-chip su-chip--lock su-narrow typo-label text-foreground">{tx(s.always_wait, { n: rules.park.length })}</span>
          <span className="su-chip su-wide typo-label text-foreground">{tx(s.delegates, { n: rules.delegate.length })}</span>
          <span className="su-chip su-wide typo-label text-foreground">{tx(s.push_targets, { n: rules.pushTargets.length })}</span>
        </div>
      )}
      {view.life !== 'none' && <div className="su-legend" aria-label={s.legend}>
        {LEGEND.map((k) => (
          <span key={k} className="typo-caption"><i className={`su-swatch su-swatch--${k}`} aria-hidden="true" />{t.athena.standup.legend[k]}</span>
        ))}
      </div>}
      <Button variant="ghost" size="icon-md" onClick={onKeys} aria-label={s.keys} icon={<Keyboard className="w-4 h-4" />} />
      <div className="su-gate">
        {view.life !== 'none' && (
          <div className="su-gate__sum su-wide">
            <p className="typo-body k-strong text-foreground">{tx(s.planned, { d: view.plannedDirections, r: view.plannedRuns })}</p>
            <p className="typo-caption">{c.proposed > 0 ? tx(s.still_proposed, { n: c.proposed }) : s.all_resolved}</p>
          </div>
        )}
        {view.life === 'decide' && (
          <Button variant="primary" size="md" loading={busy.arm} onClick={onArm} icon={<Kbd>G</Kbd>} data-testid="standup-arm">
            {tx(s.arm, { n: view.revision })}
          </Button>
        )}
        {(view.life === 'armed' || view.life === 'return') && (
          <>
            <Button variant="ghost" size="md" loading={busy.end} onClick={onEnd}>{s.end}</Button>
            <Button variant="secondary" size="md" loading={busy.open} onClick={onAmend} icon={<Kbd>N</Kbd>}>
              {tx(s.amend, { n: view.revision + 1 })}
            </Button>
          </>
        )}
      </div>
    </footer>
  );
});

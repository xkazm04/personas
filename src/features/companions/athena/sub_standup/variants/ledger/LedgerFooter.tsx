import { memo } from 'react';
import { Keyboard, Lock } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { BusyAction } from '../../data/types';
import type { StandupView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { fill, LEDGER_COPY } from './copy';

const LEGEND = ['proposed', 'decided', 'running', 'waits'] as const;

/** The state legend lives behind the help press: inert tip content, the press opens the full key card. */
function Legend() {
  const { t } = useTranslation();
  return (
    <span className="sl-legend">
      {LEGEND.map((k) => (
        <span key={k} className="typo-caption text-foreground"><i className={`sl-swatch sl-seg--${k}`} aria-hidden="true" />{t.athena.standup.legend[k]}</span>
      ))}
      <span className="typo-caption">{LEDGER_COPY.footer.help_keys}</span>
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

/** Just the go-gate: away rules and help as two quiet presses, then the plan in one sentence and its button. */
export const LedgerFooter = memo(function LedgerFooter({ view, rules, busy, onRules, onKeys, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  const f = LEDGER_COPY.footer;
  const c = view.counts;
  const plan = view.plannedDirections > 0 ? fill(f.plan, { d: view.plannedDirections, r: view.plannedRuns }) : f.plan_none;
  return (
    <footer className="sl-foot">
      {rules && (
        <Button variant="secondary" size="sm" onClick={onRules} icon={<Lock className="w-4 h-4" />}>
          {fill(f.rules, { n: rules.park.length })}
        </Button>
      )}
      <Tooltip content={<Legend />} placement="top">
        <Button variant="ghost" size="icon-md" onClick={onKeys} aria-label={f.help} icon={<Keyboard className="w-4 h-4" />} />
      </Tooltip>
      {view.life !== 'none' && (
        <p className="sl-foot__plan typo-body">
          <span className="k-strong text-foreground">{plan}</span>{' '}
          <span className="typo-caption sl-wide">{c.proposed > 0 ? fill(f.still, { n: c.proposed }) : f.resolved}</span>
        </p>
      )}
      <span className="sl-foot__go">
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
      </span>
    </footer>
  );
});

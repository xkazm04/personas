import { memo } from 'react';
import { Keyboard, ShieldCheck } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { KitButton } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { BusyAction } from '../../data/types';
import type { StandupView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { BRIEFING } from './copy';
import { rich } from './rich';

const G = BRIEFING.gate;

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

/** The plan in one sentence: what will run, and what stays off. */
function Summary({ view }: { view: StandupView }) {
  const n = view.counts.proposed;
  if (view.life === 'armed' || view.life === 'return') {
    return <p className="typo-body text-foreground">{rich(G.armed, { n: view.revision, d: view.plannedDirections, r: view.plannedRuns })}</p>;
  }
  return (
    <p className="typo-body text-foreground">
      {rich(G.draft, { d: view.plannedDirections, r: view.plannedRuns })}{' '}
      <span className="typo-caption">{n > 0 ? rich(G.open_off, { n }) : G.all_set}</span>
    </p>
  );
}

/**
 * The slim go-gate under the column: the plan sentence, the away rules as ONE
 * button carrying its count (the sheet holds the detail), keys, and Arm (or
 * Amend / End once armed).
 */
export const GateBar = memo(function GateBar({ view, rules, busy, onRules, onKeys, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  if (view.life === 'none') return null;
  return (
    <footer className="sb-gate" data-testid="briefing-gate">
      <div className="sb-gate__sum"><Summary view={view} /></div>
      {rules && (
        <KitButton tone="quiet" hint="R" icon={<ShieldCheck />} onClick={onRules} testId="briefing-rules">
          {G.rules} · {tx(G.rules_count, { n: rules.park.length })}
        </KitButton>
      )}
      <Button variant="ghost" size="icon-md" onClick={onKeys} aria-label={s.keys} icon={<Keyboard className="w-4 h-4" />} />
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
    </footer>
  );
});

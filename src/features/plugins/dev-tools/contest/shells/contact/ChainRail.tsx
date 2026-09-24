// The darkroom chain as a rail: collect → visual pass → (judges) → ready,
// each step done / active / waiting / failed, with the chain's stated reason.
// Extractable: a compact autopilot-progress rail.
import { Check, Circle, CircleDot, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { ContestChain } from '@/lib/bindings/ContestChain';

import { chainStepLabel } from '../../model/labels';
import { CONTACT_COPY as C } from './copy';
import { chainRail, type RailState, type RailStep } from './contactModel';

const STEP_LABEL: Readonly<Record<RailStep, string>> = {
  collect: C.chainCollect,
  visual: C.chainVisual,
  judges: C.chainJudges,
  ready: C.chainReady,
};

const STATE_CLASS: Readonly<Record<RailState, string>> = {
  done: 'text-status-success border-status-success/30',
  active: 'text-primary border-primary/40 bg-primary/5',
  todo: 'text-foreground border-primary/10',
  failed: 'text-status-error border-status-error/30',
};

function StateIcon({ state }: { state: RailState }) {
  if (state === 'done') return <Check className="w-3.5 h-3.5" aria-hidden />;
  if (state === 'active') return <CircleDot className="w-3.5 h-3.5" aria-hidden />;
  if (state === 'failed') return <X className="w-3.5 h-3.5" aria-hidden />;
  return <Circle className="w-3.5 h-3.5" aria-hidden />;
}

export function ChainRail({ chain, judgesEnabled }: { chain: ContestChain; judgesEnabled: boolean }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const rail = chainRail(chain.step, judgesEnabled);
  return (
    <div className="space-y-1.5" data-testid="contact-chain-rail">
      <div className="flex flex-wrap items-center gap-2">
        <span className="typo-label text-foreground">{C.chainTitle}</span>
        <span className="typo-caption text-foreground">{chainStepLabel(s, chain.step)}</span>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5">
        {rail.map(({ step, state }, i) => (
          <li key={step} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-4 bg-primary/20" aria-hidden />}
            <span
              className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 typo-caption ${STATE_CLASS[state]}`}
              data-state={state}
            >
              <StateIcon state={state} />
              {STEP_LABEL[step]}
            </span>
          </li>
        ))}
      </ol>
      {chain.reason && <p className="typo-caption text-foreground">{chain.reason}</p>}
    </div>
  );
}

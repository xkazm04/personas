/**
 * The Breach card's dock: amend (`1`), deny (`2`), suspend (`3`), then the
 * item's own branches from `4`, its links, Later. Amend names exactly what it
 * does ("Widen: let the steward triage incidents", "Let merges land when the
 * gates are green", or the item's own yes) with a hint saying whether it
 * touches the envelope or only this item. An amend on merge or spend arms
 * first and says what leaves; deny swaps the dock for the clause's reasons.
 */
import { Check, PauseCircle, X } from 'lucide-react';
import { mergeLabel, scopeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import type { BreachPlan } from '../../mandate/breachPlan';
import { ArmedBox } from '../ArmedBox';
import { Branch, Later, Links, Verdict } from '../DeckDock';
import { ReasonPrompt } from '../ReasonPrompt';
import type { DeckActions } from '../useDeckActions';
import type { DeckController } from '../useDeck';
import { useUsd } from './SignParts';
import type { BreachShape } from './useBreachShape';

function useAmendLabel(item: DecisionItem, plan: BreachPlan, cap: number | null): string {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const usd = useUsd();
  const a = plan.amend;
  switch (a.kind) {
    case 'scope': return tx(m.ml_breach_amend_scope, { scope: scopeLabel(m, a.scope) });
    case 'merge': return tx(m.ml_breach_amend_merge, { policy: mergeLabel(m, a.to) });
    case 'spend': return tx(m.ml_breach_amend_spend, { cap: usd(cap ?? 0) });
    case 'item': return item.verdictLabels.accept;
  }
}

export function BreachDock({ item, deck, act, breach }: { item: DecisionItem; deck: DeckController; act: DeckActions; breach: BreachShape }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const plan = breach.plan!;
  const amendLabel = useAmendLabel(item, plan, breach.cap);
  if (deck.prompt) {
    return <ReasonPrompt prompt={deck.prompt} min={0} onSubmit={act.submitReason} onCancel={() => deck.setPrompt(null)} />;
  }
  const armed = deck.armed === 'accept';
  const env = plan.amend.kind !== 'item';
  const leaves = env ? plan.arms : item.irreversible;
  const arms = env ? !!plan.arms : !!item.irreversible;
  return (
    <>
      {armed && leaves && <ArmedBox kind={leaves} title={env ? amendLabel : item.title} />}
      <div className="grid grid-cols-1 gap-2">
        <Verdict
          k={arms ? '1 ↵' : '1'}
          label={amendLabel}
          yes
          tone="success"
          icon={<Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
          armed={armed}
          disabled={breach.capInvalid}
          onClick={() => breach.amend(act.defaultAccept)}
        />
        <span className="-mt-1 px-1 typo-caption">{env ? m.ml_breach_amend_env_hint : m.ml_breach_amend_item_hint}</span>
        <Verdict k="2" label={m.ml_breach_deny} yes={false} tone="danger" icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} onClick={breach.deny} />
      </div>
      {plan.canSuspend
        ? <Branch k="3" label={m.ml_suspend} hint={m.ml_breach_suspend_hint} icon={<PauseCircle className="h-4 w-4" aria-hidden />} onClick={breach.suspend} />
        : <span className="px-1 typo-caption">{m.ml_breach_no_mandate}</span>}
      {item.branches.map((b, i) => (
        <Branch key={b.id} k={String(i + 1 + act.offset)} label={b.label} hint={b.hint} accent={b.tone === 'accent'} onClick={() => act.branch(i + 1 + act.offset)} />
      ))}
      <Links item={item} act={act} />
      <Later label={item.verdictLabels.skip} onSkip={act.skip} />
    </>
  );
}

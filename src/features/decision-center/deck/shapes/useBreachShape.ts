/**
 * The Breach card's verbs, keyed 1-3:
 *   1 amend    what `breachPlan` says amend means here: widen a scope, let
 *              merges land, raise the cap (each an envelope change on the
 *              item's mandate), or decide the item itself. Merge and spend
 *              ARM first; the second press or Enter confirms.
 *   2 deny     the clause's reason prompt, then the item is rejected with it.
 *   3 suspend  the mandate is suspended; its items wait, held, until resumed.
 * An envelope amend or a suspend leaves the item undecided: the router files
 * it again under the new envelope, and the card leaves when the lane does.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { DecisionItem } from '../../model/decisionModel';
import { breachPlan, denyPrompt, type BreachPlan } from '../../mandate/breachPlan';
import type { DeckController } from '../useDeck';
import type { ShapeRoute } from './cardShape';

export interface BreachShape {
  plan: BreachPlan | null;
  /** The new cap a spend amend would set; null until typed. */
  cap: number | null;
  setCap: (usd: number | null) => void;
  /** The typed cap does not raise today's: nothing to amend yet. */
  capInvalid: boolean;
  amend: (decideItem: () => void) => void;
  deny: () => void;
  suspend: () => void;
}

function changeOf(plan: BreachPlan, cap: number | null): MandateChange | null {
  const a = plan.amend;
  if (a.kind === 'scope') return { kind: 'widenScope', scopes: [a.scope] };
  if (a.kind === 'merge') return { kind: 'setMergePolicy', policy: a.to };
  if (a.kind === 'spend') return typeof cap === 'number' && cap > (a.from ?? 0) ? { kind: 'setBudget', usd: cap } : null;
  return null;
}

export function useBreachShape(active: boolean, item: DecisionItem | undefined, route: ShapeRoute | null, mandate: MandateSummary | null, deck: DeckController): BreachShape {
  const { t } = useTranslation();
  const plan = useMemo(
    () => (active && item && route ? breachPlan(item, route.clause, mandate) : null),
    [active, item, route, mandate],
  );
  const from = plan?.amend.kind === 'spend' ? plan.amend.from : null;
  const [cap, setCapState] = useState<number | null>(null);
  useEffect(() => { setCapState(from); }, [item?.id, from]);
  const { setArmed } = deck;
  const setCap = useCallback((usd: number | null) => { setCapState(usd); setArmed(null); }, [setArmed]);
  const change = plan ? changeOf(plan, cap) : null;
  const charterId = route?.charterId ?? null;

  const amend = useCallback((decideItem: () => void) => {
    if (!plan) return;
    if (plan.amend.kind === 'item') { decideItem(); return; }
    if (!change || !charterId) return;
    if (plan.arms && deck.armed !== 'accept') { deck.setArmed('accept'); return; }
    deck.decide({ verdict: 'accept', mandateAct: { op: 'amend', charterId, change } }, 'accept');
  }, [plan, change, charterId, deck]);

  const deny = useCallback(() => {
    if (plan) deck.setPrompt(denyPrompt(t.monitor, plan.clause));
  }, [plan, deck, t]);

  const suspend = useCallback(() => {
    if (!plan?.canSuspend || !charterId) return;
    deck.decide({ verdict: 'done', mandateAct: { op: 'suspend', charterId } }, 'done');
  }, [plan, charterId, deck]);

  return {
    plan, cap, setCap,
    capInvalid: plan?.amend.kind === 'spend' && !change,
    amend, deny, suspend,
  };
}

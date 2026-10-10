// The sentence above the rail. Since the measured-health model (spark
// lifecycle-health, WP4) it names the step with the worst MEASURED verdict
// (`headline.weakestByHealth`): the old sentence named the weakest BINDING and
// so said "Docs" while Docs measured healthy. The binding sentence survives
// only as the fallback for a snapshot with no health rows at all (a backend
// before measurement, or a project never measured).
import { useMemo } from 'react';

import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { bindingStatePhrase, stepLabel } from '../journey/journeyLabels';
import { weakest } from '../journey/journeyModel';
import type { JourneyNode } from '../journey/journeyModel';
import { reasonBody, weakestByHealth } from './headline';
import { joinHealth } from './layer1/healthModel';
import { healthPhrase } from './layer1/layer1Labels';
import type { LifecycleViewModel } from './useLifecycleView';

type Tx = LifecycleViewModel['tx'];

export interface LifecycleHeadline {
  headline: string;
  /** The measured verdict the sentence reports; null in the binding fallback or when nothing is named. */
  headlineHealth: LifecycleHealth | null;
  /** The binding state the FALLBACK sentence reports; null whenever the health sentence speaks. */
  headlineState: LifecycleBindingState | null;
  /** The step the sentence names, for Ask Athena; null when none is named. */
  headlineStepId: string | null;
}

export function useLifecycleHeadline(
  dl: LifecycleViewModel['dl'],
  tx: Tx,
  current: LifecycleSnapshot | null,
  order: JourneyNode[],
): LifecycleHeadline {
  return useMemo(() => {
    const health = current?.health ?? [];
    if (current && health.length > 0) {
      const pick = weakestByHealth(joinHealth(order, health));
      if (!pick) return { headline: dl.lc2_headline_all_green, headlineHealth: null, headlineState: null, headlineStepId: null };
      const step = stepLabel(dl, pick.node.id, pick.node.label);
      const reason = reasonBody(pick.reason);
      const headline = reason
        ? tx(dl.lc2_headline_weakest_reason, { step, health: healthPhrase(dl, pick.health), reason })
        : tx(dl.lc2_headline_weakest, { step, health: healthPhrase(dl, pick.health) });
      return { headline, headlineHealth: pick.health, headlineState: null, headlineStepId: pick.node.id };
    }

    // Fallback: no measurement at all, so the binding sentence is the best we know.
    const weak = current ? weakest(current) : null;
    const weakSentence = weak
      ? tx(weak.skipped > 0 ? dl.lc_weakest_with_skips : dl.lc_weakest_plain, {
          step: stepLabel(dl, weak.node.id, weak.node.label),
          state: bindingStatePhrase(dl, weak.node.strongestState),
          skipped: weak.skipped,
          total: weak.total,
        })
      : null;
    const headline = !current || current.evidence.length === 0
      ? [dl.lc_no_evidence, weakSentence].filter(Boolean).join(' ')
      : weakSentence ?? dl.lc_all_strong;
    return {
      headline,
      headlineHealth: null,
      headlineState: weak?.node.strongestState ?? null,
      headlineStepId: weak?.node.id ?? null,
    };
  }, [dl, tx, current, order]);
}

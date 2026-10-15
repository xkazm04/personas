/**
 * useGoalMetWhen — the conditions a goal claim names for "met"
 * (`goal_met_when`, the `dev_goals.met_when` reader), once per card.
 *
 * `null` while reading, `'failed'` when the read failed (never shown as "no
 * conditions": a failed read is not an answer).
 */
import { useEffect, useState } from 'react';

import { getGoalMetWhen } from '@/api/mandates';
import type { GoalMetWhen } from '@/lib/bindings/GoalMetWhen';
import { silentCatch } from '@/lib/silentCatch';

export type MetWhenState = GoalMetWhen | 'failed' | null;

export function useGoalMetWhen(goalId: string | null): MetWhenState {
  const [state, setState] = useState<MetWhenState>(null);
  useEffect(() => {
    setState(null);
    if (!goalId) return;
    let live = true;
    getGoalMetWhen(goalId)
      .then((row) => { if (live) setState(row); })
      .catch((err: unknown) => {
        silentCatch('decisionCenter.goalMetWhen')(err);
        if (live) setState('failed');
      });
    return () => { live = false; };
  }, [goalId]);
  return state;
}

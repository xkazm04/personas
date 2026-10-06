/**
 * Decision Center prototype round (spark decision-center, Track B): the dev-only
 * Lab that renders one prototype direction on the fixture roster. Synthetic,
 * no IPC. `--kit p2:modal:report` (shoot.mjs) picks direction and entry point.
 */
import type { HarnessModule } from './registry';

export const DECISION_CENTER_MODULES: Record<string, HarnessModule> = {
  'decision-center/prototype': {
    load: () => import('@/features/decision-center/prototype/DecisionPrototypeLab'),
  },
};

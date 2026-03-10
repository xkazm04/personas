/**
 * stepTransitions — step transition map for the adoption wizard.
 *
 * Extracted to avoid circular dependencies between AdoptionWizardContext
 * and useAdoptionActions.
 */
import type { AdoptWizardStep, AdoptState } from './useAdoptReducer';

export type StepAction = 'navigate' | 'transform' | 'continue' | 'confirm' | 'close';

interface StepTransition {
  action: StepAction;
  target?: AdoptWizardStep;
}

/**
 * Each step declares its transition: either a direct step navigation or an async action.
 */
export const STEP_TRANSITIONS: Record<
  AdoptWizardStep,
  (state: AdoptState) => StepTransition
> = {
  choose: () => ({ action: 'navigate', target: 'connect' }),
  connect: () => ({ action: 'navigate', target: 'tune' }),
  tune: (s) =>
    s.backgroundAdoptId
      ? { action: 'continue' }
      : { action: 'transform' },
  build: (s) =>
    s.draft
      ? { action: 'navigate', target: 'create' }
      : { action: 'navigate' }, // no-op when no draft
  create: () => ({ action: 'confirm' }),
};

import type { WizardDeps } from './n8nWizardTypes';
import { createTransformHandlers } from './useN8nWizardTransformHandlers';
import { createLifecycleHandlers } from './useN8nWizardLifecycleHandlers';

export type { WizardDeps } from './n8nWizardTypes';

export function createWizardHandlers(deps: WizardDeps) {
  const { state, dispatch } = deps;
  const { handleTransform, handleCancelTransform, handleContinueTransform } = createTransformHandlers(deps);
  const { handleConfirmSave, handleTestDraft, handleReset } = createLifecycleHandlers(deps);

  const handleNext = () => {
    switch (state.step) {
      case 'analyze':
        void handleTransform();
        break;
      case 'transform':
        if (state.transformSubPhase === 'answering') {
          void handleContinueTransform();
        } else if (state.draft) {
          dispatch({ type: 'GO_TO_STEP', step: 'edit' });
        }
        break;
      case 'edit':
        dispatch({ type: 'GO_TO_STEP', step: 'confirm' });
        break;
      case 'confirm':
        void handleConfirmSave();
        break;
    }
  };

  return {
    handleTransform,
    handleConfirmSave,
    handleTestDraft,
    handleCancelTransform,
    handleReset,
    handleContinueTransform,
    handleNext,
  };
}

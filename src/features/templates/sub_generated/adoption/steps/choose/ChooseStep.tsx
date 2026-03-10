import { useAdoptionWizard } from '../../AdoptionWizardContext';
import { ChooseStepFlows } from './ChooseStepFlows';
import { ChooseStepFallback } from './ChooseStepFallback';

// Re-export helper for external consumers
export { deriveRequirementsFromFlows } from './chooseStepHelpers';

export function ChooseStep() {
  const { useCaseFlows } = useAdoptionWizard();
  const hasFlows = useCaseFlows.length > 0;

  if (hasFlows) {
    return <ChooseStepFlows />;
  }

  return <ChooseStepFallback />;
}

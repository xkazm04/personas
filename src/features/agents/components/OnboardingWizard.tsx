import { AnimatePresence } from 'framer-motion';
import { TemplatePickerStep } from '@/features/agents/components/onboarding/OnboardingTemplateStep';

export default function OnboardingWizard() {
  return (
    <div className="flex items-center justify-center h-full overflow-y-auto">
      <AnimatePresence mode="wait">
        <TemplatePickerStep key="picker" onBack={() => {}} />
      </AnimatePresence>
    </div>
  );
}

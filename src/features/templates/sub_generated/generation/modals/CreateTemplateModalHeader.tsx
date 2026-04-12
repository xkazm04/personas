import { X, Wand2 } from 'lucide-react';
import { WizardStepper } from '@/features/shared/components/progress/WizardStepper';

interface CreateTemplateModalHeaderProps {
  wizardSteps: { key: string; label: string }[];
  currentIndex: number;
  onClose: () => void;
}

export function CreateTemplateModalHeader({
  wizardSteps,
  currentIndex,
  onClose,
}: CreateTemplateModalHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
          <Wand2 className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <h2 id="create-template-title" className="text-base font-semibold text-foreground/80">{ t.templates.generation.create_template}</h2>
          <p className="text-sm text-muted-foreground/80">Design a reusable persona template with AI</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <WizardStepper steps={wizardSteps} currentIndex={currentIndex} />
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-secondary/60 transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground/90" />
        </button>
      </div>
    </div>
  );
}

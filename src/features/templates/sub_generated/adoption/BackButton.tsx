import { ArrowLeft } from 'lucide-react';
import { useAdoptionWizard } from './AdoptionWizardContext';

interface BackButtonProps {
  state: { step: string; confirming: boolean; created: boolean; transforming: boolean; questionGenerating: boolean };
  onClose: () => void;
  onBack: () => void;
  getBackLabel: () => string;
}

export function BackButton({ state, onClose, onBack, getBackLabel }: BackButtonProps) {
  const { cancelTransform } = useAdoptionWizard();

  return (
    <button
      onClick={() => {
        if (state.step === 'choose') onClose();
        else if (state.step === 'tune' && state.questionGenerating) return;
        else if (state.step === 'build' && state.transforming) void cancelTransform();
        else onBack();
      }}
      disabled={state.confirming || state.created || (state.step === 'tune' && state.questionGenerating)}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {getBackLabel()}
    </button>
  );
}

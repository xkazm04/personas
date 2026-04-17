import { Pencil, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { TransformProgress } from '@/features/shared/components/progress/TransformProgress';
import { CompilationStepper } from './CompilationStepper';
import type { AgentIR } from '@/lib/types/designTypes';

interface DesignPhaseAnalyzingProps {
  instruction: string;
  outputLines: string[];
  savedDesignResult: AgentIR | null;
  onCancel: () => void;
}

export function DesignPhaseAnalyzing({ instruction, outputLines, savedDesignResult, onCancel }: DesignPhaseAnalyzingProps) {
  const { t } = useTranslation();
  return (
    <div
      key="analyzing"
      className="animate-fade-slide-in space-y-3"
    >
      {savedDesignResult && (
        <div className="flex items-center gap-2 px-1 typo-body text-foreground">
          <Pencil className="w-3 h-3 shrink-0" />
          <span>{t.agents.design.updating_design}</span>
        </div>
      )}
      <div className="bg-secondary/30 rounded-modal px-4 py-3 typo-body text-foreground/90 border border-primary/20">
        {instruction}
      </div>

      <CompilationStepper outputLines={outputLines} isRunning={true} />

      <TransformProgress mode="analysis" lines={outputLines} isRunning={true} />

      <button
        onClick={onCancel}
        className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-modal typo-body font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
        {t.common.cancel}
      </button>
    </div>
  );
}

import { ArrowLeft, ArrowRight, Sparkles, RefreshCw, Check, AlertCircle } from 'lucide-react';
import type { N8nWizardStep, TransformSubPhase } from './useN8nImportReducer';

interface N8nWizardFooterProps {
  step: N8nWizardStep;
  canGoBack: boolean;
  onBack: () => void;
  onNext: () => void;
  transforming: boolean;
  confirming: boolean;
  created: boolean;
  hasDraft: boolean;
  hasParseResult: boolean;
  transformSubPhase?: TransformSubPhase;
  analyzing?: boolean;
  /** Number of connectors still needing credentials */
  connectorsMissing?: number;
}

export function N8nWizardFooter({
  step,
  canGoBack,
  onBack,
  onNext,
  transforming,
  confirming,
  created,
  hasDraft,
  hasParseResult,
  transformSubPhase,
  analyzing,
  connectorsMissing = 0,
}: N8nWizardFooterProps) {
  // No footer on upload step
  if (step === 'upload') return null;

  const getNextAction = (): {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    disabled: boolean;
    variant: 'violet' | 'emerald';
    spinning?: boolean;
  } | null => {
    switch (step) {
      case 'analyze':
        if (analyzing) {
          return { label: 'Analyzing...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true };
        }
        return {
          label: 'Analyze & Transform',
          icon: Sparkles,
          disabled: !hasParseResult || transforming,
          variant: 'violet',
        };
      case 'transform': {
        const sub = transformSubPhase ?? 'idle';
        if (sub === 'asking') {
          return { label: 'Analyzing...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true };
        }
        if (sub === 'answering') {
          return { label: 'Submit Answers & Generate', icon: Sparkles, disabled: false, variant: 'violet' };
        }
        if (sub === 'generating') {
          return { label: 'Generating...', icon: RefreshCw, disabled: true, variant: 'violet', spinning: true };
        }
        // completed or failed
        return { label: 'View Draft', icon: ArrowRight, disabled: !hasDraft, variant: 'violet' };
      }
      case 'edit':
        return {
          label: 'Review & Confirm',
          icon: ArrowRight,
          disabled: !hasDraft || transforming,
          variant: 'violet',
        };
      case 'confirm':
        if (created) {
          return { label: 'Persona Saved', icon: Check, disabled: true, variant: 'emerald' };
        }
        return confirming
          ? { label: 'Saving...', icon: RefreshCw, disabled: true, variant: 'emerald', spinning: true }
          : { label: 'Confirm & Save Persona', icon: Check, disabled: !hasDraft, variant: 'emerald' };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10">
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="flex items-center gap-3">
        {/* Connector warning — shown on edit step when connectors are unmapped */}
        {step === 'edit' && connectorsMissing > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-orange-400/80">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {connectorsMissing} connector{connectorsMissing !== 1 ? 's' : ''} need credentials
          </span>
        )}

        {nextAction && (
          <button
            onClick={onNext}
            disabled={nextAction.disabled}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              nextAction.variant === 'emerald'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25'
                : 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
            }`}
          >
            <nextAction.icon
              className={`w-4 h-4 ${nextAction.spinning ? 'animate-spin' : ''}`}
            />
            {nextAction.label}
          </button>
        )}
      </div>
    </div>
  );
}

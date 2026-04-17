import { ArrowLeft, ArrowRight, RefreshCw, Check, AlertCircle, FlaskConical, CheckCircle2, Wand2, Hammer } from 'lucide-react';
import type { N8nWizardStep } from '../hooks/useN8nImportReducer';
import { useTranslation } from '@/i18n/useTranslation';

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
  analyzing?: boolean;
  /** Number of connectors still needing credentials */
  connectorsMissing?: number;
  /** Draft validation status */
  testStatus?: 'idle' | 'running' | 'passed' | 'failed';
  testError?: string | null;
  onTest?: () => void;
  /** Called to trigger re-generation with the pre-filled adjustment request */
  onApplyAdjustment?: () => void;
  /** Called to build the persona through the PersonaMatrix */
  onProcessWithMatrix?: () => void;
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
  analyzing,
  connectorsMissing = 0,
  testStatus = 'idle',
  testError,
  onTest,
  onApplyAdjustment,
  onProcessWithMatrix,
}: N8nWizardFooterProps) {
  const { t } = useTranslation();
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
        return null;
      case 'edit':
        return {
          label: t.templates.n8n.review_and_confirm,
          icon: ArrowRight,
          disabled: !hasDraft || transforming || testStatus !== 'passed' || connectorsMissing > 0,
          variant: 'violet',
        };
      case 'confirm':
        if (created) {
          return { label: t.templates.n8n.persona_saved, icon: Check, disabled: true, variant: 'emerald' };
        }
        return confirming
          ? { label: t.templates.n8n.saving, icon: RefreshCw, disabled: true, variant: 'emerald', spinning: true }
          : { label: t.templates.n8n.confirm_and_save, icon: Check, disabled: !hasDraft, variant: 'emerald' };
      default:
        return null;
    }
  };

  const nextAction = getNextAction();

  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-primary/10 bg-secondary/10">
      {/* Left: ghost Back button */}
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-modal text-foreground hover:text-muted-foreground hover:bg-secondary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      {/* Separator */}
      <div className="w-px h-6 bg-primary/10 mx-2 flex-shrink-0" />

      {/* Right: action group */}
      <div className="flex items-center gap-3">
        {/* Connector warning -- shown on edit step when connectors are unmapped */}
        {step === 'edit' && connectorsMissing > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-orange-400/80">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {connectorsMissing} connector{connectorsMissing !== 1 ? 's' : ''} need credentials
          </span>
        )}

        {/* Test error message */}
        {step === 'edit' && testStatus === 'failed' && testError && (
          <span className="text-sm text-red-400/80 max-w-[400px] line-clamp-2 leading-tight" title={testError}>
            {testError}
          </span>
        )}

        {/* Test Persona button -- secondary action on edit step */}
        {step === 'edit' && onTest && (
          <button
            onClick={onTest}
            disabled={testStatus === 'running' || !hasDraft}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-modal border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              testStatus === 'passed'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                : testStatus === 'failed'
                  ? 'bg-red-500/10 text-red-300 border-red-500/25 hover:bg-red-500/20'
                  : 'bg-blue-500/10 text-blue-300 border-blue-500/25 hover:bg-blue-500/20'
            }`}
          >
            {testStatus === 'running' ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> {t.templates.n8n.testing_btn}</>
            ) : testStatus === 'passed' ? (
              <><CheckCircle2 className="w-4 h-4 text-emerald-400" /> {t.templates.n8n.test_passed}</>
            ) : testStatus === 'failed' ? (
              <><AlertCircle className="w-4 h-4 text-red-400" /> {t.templates.n8n.retest}</>
            ) : (
              <><FlaskConical className="w-4 h-4" /> {t.templates.n8n.test_persona}</>
            )}
          </button>
        )}

        {/* Fix & Regenerate -- shown on edit step when test failed */}
        {step === 'edit' && testStatus === 'failed' && onApplyAdjustment && (
          <button
            onClick={onApplyAdjustment}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-modal border bg-amber-500/10 text-amber-300 border-amber-500/25 hover:bg-amber-500/20 transition-colors"
          >
            <Wand2 className="w-4 h-4" />
            Fix & Regenerate
          </button>
        )}

        {/* Build Persona -- primary action on analyze step */}
        {step === 'analyze' && onProcessWithMatrix && hasParseResult && (
          <button
            onClick={onProcessWithMatrix}
            disabled={analyzing}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-modal border bg-violet-500/25 text-violet-300 border-violet-500/30 hover:bg-violet-500/35 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {analyzing ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> {t.templates.n8n.analyzing_btn}</>
            ) : (
              <><Hammer className="w-4 h-4" /> {t.templates.n8n.build_persona}</>
            )}
          </button>
        )}

        {/* Primary CTA -- filled background, bolder weight */}
        {nextAction && (
          <button
            onClick={onNext}
            disabled={nextAction.disabled}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-modal border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              nextAction.variant === 'emerald'
                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/35'
                : 'bg-violet-500/25 text-violet-300 border-violet-500/30 hover:bg-violet-500/35'
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

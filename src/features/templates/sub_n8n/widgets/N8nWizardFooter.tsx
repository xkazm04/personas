import { ArrowLeft, ArrowRight, RefreshCw, Check, AlertCircle, FlaskConical, CheckCircle2, Wand2, Hammer } from 'lucide-react';
import type { N8nWizardStep } from '../hooks/useN8nImportReducer';
import Button, { type AccentColor } from '@/features/shared/components/buttons/Button';
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
      <Button variant="ghost" size="md" onClick={onBack} disabled={!canGoBack} icon={<ArrowLeft className="w-3.5 h-3.5" />}>
        {t.templates.n8n.back}
      </Button>

      {/* Separator */}
      <div className="w-px h-6 bg-primary/10 mx-2 flex-shrink-0" />

      {/* Right: action group */}
      <div className="flex items-center gap-3">
        {/* Connector warning -- shown on edit step when connectors are unmapped */}
        {step === 'edit' && connectorsMissing > 0 && (
          <span className="flex items-center gap-1.5 typo-body text-orange-400/80">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {t.templates.n8n.connectors_need_credentials.replace('{count}', String(connectorsMissing))}
          </span>
        )}

        {/* Test error message */}
        {step === 'edit' && testStatus === 'failed' && testError && (
          <span className="typo-body text-red-400/80 max-w-[400px] line-clamp-2 leading-tight" title={testError}>
            {testError}
          </span>
        )}

        {/* Test Persona button -- secondary action on edit step */}
        {step === 'edit' && onTest && (
          <Button
            variant="accent"
            accentColor={testStatus === 'passed' ? 'emerald' : testStatus === 'failed' ? 'rose' : 'blue'}
            onClick={onTest}
            disabled={!hasDraft}
            loading={testStatus === 'running'}
            loadingLabel={t.templates.n8n.testing_btn}
            icon={testStatus === 'passed'
              ? <CheckCircle2 className="w-4 h-4" />
              : testStatus === 'failed'
                ? <AlertCircle className="w-4 h-4" />
                : <FlaskConical className="w-4 h-4" />}
          >
            {testStatus === 'passed'
              ? t.templates.n8n.test_passed
              : testStatus === 'failed'
                ? t.templates.n8n.retest
                : t.templates.n8n.test_persona}
          </Button>
        )}

        {/* Fix & Regenerate -- shown on edit step when test failed */}
        {step === 'edit' && testStatus === 'failed' && onApplyAdjustment && (
          <Button variant="accent" accentColor="amber" onClick={onApplyAdjustment} icon={<Wand2 className="w-4 h-4" />}>
            {t.templates.n8n.fix_and_regenerate}
          </Button>
        )}

        {/* Build Persona -- primary action on analyze step */}
        {step === 'analyze' && onProcessWithMatrix && hasParseResult && (
          <Button
            variant="accent"
            accentColor="violet"
            onClick={onProcessWithMatrix}
            loading={analyzing}
            loadingLabel={t.templates.n8n.analyzing_btn}
            icon={<Hammer className="w-4 h-4" />}
          >
            {t.templates.n8n.build_persona}
          </Button>
        )}

        {/* Primary CTA -- filled background, bolder weight */}
        {nextAction && (
          <Button
            variant="accent"
            accentColor={nextAction.variant as AccentColor}
            onClick={onNext}
            disabled={nextAction.disabled}
            loading={nextAction.spinning}
            icon={<nextAction.icon className="w-4 h-4" />}
          >
            {nextAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}

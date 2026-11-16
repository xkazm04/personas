import { motion } from 'framer-motion';
import { ExternalLink, Check, CheckCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { openExternalUrl } from '@/api/system/system';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { CaptureFieldRow, HelpSection } from './NegotiatorStepCardHelpers';
import type { NegotiatorStepCardProps } from './NegotiatorStepCardHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

type StepExpandedContentProps = Pick<NegotiatorStepCardProps,
  'step' | 'stepIndex' | 'isCompleted' | 'capturedValues' | 'onComplete' | 'onCaptureValue' | 'onRequestHelp' | 'stepHelp' | 'isLoadingHelp'
>;

export function StepExpandedContent({
  step,
  stepIndex,
  isCompleted,
  capturedValues,
  onComplete,
  onCaptureValue,
  onRequestHelp,
  stepHelp,
  isLoadingHelp,
}: StepExpandedContentProps) {
  const { t } = useTranslation();
  const neg = t.vault.negotiator;
  const allFieldsCaptured = step.field_fills
    ? Object.keys(step.field_fills).every((key) => capturedValues[key]?.trim())
    : true;

  const handleOpenUrl = async () => {
    const safe = sanitizeExternalUrl(step.url);
    if (!safe) return;
    try {
      await openExternalUrl(safe);
    } catch {
      window.open(safe, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <motion.div
      className="px-4 pb-4 space-y-3"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
      data-testid={`negotiator-step-${stepIndex}-content`}
    >
      {/* Description */}
      <motion.p
        variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
        className="typo-body text-foreground"
        data-testid={`negotiator-step-${stepIndex}-description`}
      >
        {step.description}
      </motion.p>

      {/* Visual hint */}
      {step.visual_hint && (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
          className="px-3 py-2 rounded-modal bg-surface-2 border border-hair typo-body text-ink-1"
          data-testid={`negotiator-step-${stepIndex}-visual-hint`}
        >
          {step.visual_hint}
        </motion.div>
      )}

      {/* URL button */}
      {step.url && (
        <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }} className="space-y-1">
          <Button
            type="button"
            onClick={handleOpenUrl}
            variant="accent"
            tone="agent"
            size="md"
            data-testid={`negotiator-step-${stepIndex}-open-url-btn`}
            icon={<ExternalLink className="w-3.5 h-3.5" />}
          >
            {neg.open_in_browser}
          </Button>
          <p className="typo-code text-foreground truncate pl-0.5">{step.url}</p>
        </motion.div>
      )}

      {/* Waiting for */}
      {step.wait_for && !isCompleted && (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
          className="flex items-start gap-2 px-3 py-2 rounded-modal bg-status-warning/10 border border-status-warning/20"
          data-testid={`negotiator-step-${stepIndex}-wait-for`}
        >
          <LoadingSpinner size="sm" className="text-status-warning mt-0.5 shrink-0" />
          <span className="typo-body text-status-warning/80">{step.wait_for}</span>
        </motion.div>
      )}

      {/* Capture fields */}
      {step.field_fills && Object.entries(step.field_fills).map(([fieldKey, hint]) => (
        <CaptureFieldRow
          key={fieldKey}
          fieldKey={fieldKey}
          hint={hint}
          stepIndex={stepIndex}
          capturedValue={capturedValues[fieldKey] || ''}
          onCaptureValue={onCaptureValue}
        />
      ))}

      {/* Help section */}
      <HelpSection
        stepIndex={stepIndex}
        onRequestHelp={onRequestHelp}
        stepHelp={stepHelp}
        isLoadingHelp={isLoadingHelp}
      />

      {/* Action buttons */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
        className="flex items-center gap-2 pt-1"
        data-testid={`negotiator-step-${stepIndex}-actions`}
      >
        {!isCompleted && (
          <Button
            type="button"
            onClick={onComplete}
            disabled={step.field_fills ? !allFieldsCaptured : false}
            variant="accent"
            tone="success"
            size="md"
            data-testid={`negotiator-step-${stepIndex}-complete-btn`}
            icon={<Check className="w-3.5 h-3.5" />}
          >
            {step.field_fills ? neg.step_complete_captured : neg.mark_complete}
          </Button>
        )}
        {isCompleted && (
          <span
            className="inline-flex items-center gap-1.5 text-status-success typo-body"
            data-testid={`negotiator-step-${stepIndex}-completed-badge`}
          >
            <CheckCircle className="w-3 h-3" />
            {neg.completed}
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}

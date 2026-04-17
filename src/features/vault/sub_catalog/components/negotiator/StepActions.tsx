import { motion } from 'framer-motion';
import { ExternalLink, Check, CheckCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { openExternalUrl } from '@/api/system/system';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { CaptureFieldRow, HelpSection } from './NegotiatorStepCardHelpers';
import type { NegotiatorStepCardProps } from './NegotiatorStepCardHelpers';
import { useTranslation } from '@/i18n/useTranslation';

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
        className="text-sm text-foreground/80"
        data-testid={`negotiator-step-${stepIndex}-description`}
      >
        {step.description}
      </motion.p>

      {/* Visual hint */}
      {step.visual_hint && (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
          className="px-3 py-2 rounded-modal bg-secondary/40 border border-primary/10 text-sm text-foreground/90"
          data-testid={`negotiator-step-${stepIndex}-visual-hint`}
        >
          {step.visual_hint}
        </motion.div>
      )}

      {/* URL button */}
      {step.url && (
        <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }} className="space-y-1">
          <button
            onClick={handleOpenUrl}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-modal bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm hover:bg-violet-500/20 transition-colors"
            data-testid={`negotiator-step-${stepIndex}-open-url-btn`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in browser
          </button>
          <p className="text-sm text-muted-foreground/60 font-mono truncate pl-0.5">{step.url}</p>
        </motion.div>
      )}

      {/* Waiting for */}
      {step.wait_for && !isCompleted && (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
          className="flex items-start gap-2 px-3 py-2 rounded-modal bg-amber-500/10 border border-amber-500/20"
          data-testid={`negotiator-step-${stepIndex}-wait-for`}
        >
          <LoadingSpinner size="sm" className="text-amber-400 mt-0.5 shrink-0" />
          <span className="text-sm text-amber-200/80">{step.wait_for}</span>
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
          <button
            onClick={onComplete}
            disabled={step.field_fills ? !allFieldsCaptured : false}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-modal bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`negotiator-step-${stepIndex}-complete-btn`}
          >
            <Check className="w-3.5 h-3.5" />
            {step.field_fills ? t.vault.negotiator.step_complete_captured : t.vault.negotiator.mark_complete}
          </button>
        )}
        {isCompleted && (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-emerald-500/10 text-emerald-400 text-sm"
            data-testid={`negotiator-step-${stepIndex}-completed-badge`}
          >
            <CheckCircle className="w-3 h-3" />
            Completed
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}

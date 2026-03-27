import { motion, AnimatePresence } from 'framer-motion';
import {
  ExternalLink,
  Check,
  CheckCircle,
  Globe,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { openExternalUrl } from "@/api/system/system";

import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import {
  ACTION_ICONS,
  ACTION_COLORS,
  StepHeader,
  CaptureFieldRow,
  HelpSection,
} from '@/features/vault/sub_negotiator/NegotiatorStepCardHelpers';
import type { NegotiatorStepCardProps } from '@/features/vault/sub_negotiator/NegotiatorStepCardHelpers';
import { MOTION_TIMING } from '@/features/templates/animationPresets';

export function NegotiatorStepCard({
  step,
  stepIndex,
  totalSteps,
  isActive,
  isCompleted,
  capturedValues,
  onComplete,
  onSelect,
  onCaptureValue,
  onRequestHelp,
  stepHelp,
  isLoadingHelp,
}: NegotiatorStepCardProps) {
  const Icon = ACTION_ICONS[step.action_type] || Globe;
  const colorClasses = ACTION_COLORS[step.action_type] || ACTION_COLORS.navigate;
  const headerId = `negotiator-step-header-${stepIndex}`;

  const handleOpenUrl = async () => {
    const safe = sanitizeExternalUrl(step.url);
    if (!safe) return;
    try {
      await openExternalUrl(safe);
    } catch {
      // intentional: non-critical -- Tauri shell open failed, fall back to window.open
      window.open(safe, '_blank', 'noopener,noreferrer');
    }
  };

  // Check if all field_fills are captured
  const allFieldsCaptured = step.field_fills
    ? Object.keys(step.field_fills).every((key) => capturedValues[key]?.trim())
    : true;

  return (
    <motion.div
      layout
      initial={false}
      animate={{
        opacity: isCompleted && !isActive ? 0.6 : 1,
        scale: isActive ? 1 : 0.98,
      }}
      aria-current={isActive ? 'step' : undefined}
      aria-roledescription="step"
      aria-label={`Step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
      className={`rounded-xl border transition-all ${
        isActive
          ? 'border-violet-500/30 bg-violet-500/5 shadow-elevation-3 shadow-violet-500/5'
          : isCompleted
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-primary/10 bg-secondary/20'
      }`}
    >
      {/* Step header */}
      <StepHeader
        step={step}
        stepIndex={stepIndex}
        isActive={isActive}
        isCompleted={isCompleted}
        onSelect={onSelect}
        colorClasses={colorClasses}
        Icon={Icon}
        id={headerId}
      />

      {/* Expanded content */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            role="region"
            aria-labelledby={headerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={MOTION_TIMING.FLOW}
            className="overflow-hidden"
          >
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
                  className="px-3 py-2 rounded-xl bg-secondary/40 border border-primary/10 text-sm text-foreground/90"
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
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm hover:bg-violet-500/20 transition-colors"
                    data-testid={`negotiator-step-${stepIndex}-open-url-btn`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in browser
                  </button>
                  <p className="text-sm text-muted-foreground/60 font-mono truncate pl-0.5">{step.url}</p>
                </motion.div>
              )}

              {/* Waiting for -- hidden once step is completed */}
              {step.wait_for && !isCompleted && (
                <motion.div
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid={`negotiator-step-${stepIndex}-complete-btn`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    {step.field_fills ? 'Step complete -- values captured' : 'Mark step complete'}
                  </button>
                )}
                {isCompleted && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-sm"
                    data-testid={`negotiator-step-${stepIndex}-completed-badge`}
                  >
                    <CheckCircle className="w-3 h-3" />
                    Completed
                  </span>
                )}
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

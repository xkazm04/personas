import { motion, AnimatePresence } from 'framer-motion';
import { Globe } from 'lucide-react';
import {
  ACTION_ICONS,
  ACTION_COLORS,
  StepHeader,
} from '@/features/vault/sub_catalog/components/negotiator/NegotiatorStepCardHelpers';
import type { NegotiatorStepCardProps } from '@/features/vault/sub_catalog/components/negotiator/NegotiatorStepCardHelpers';
import { MOTION_TIMING } from '@/features/templates/animationPresets';
import { StepExpandedContent } from './StepActions';

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
      className={`rounded-modal border transition-all ${
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
            <StepExpandedContent
              step={step}
              stepIndex={stepIndex}
              isCompleted={isCompleted}
              capturedValues={capturedValues}
              onComplete={onComplete}
              onCaptureValue={onCaptureValue}
              onRequestHelp={onRequestHelp}
              stepHelp={stepHelp}
              isLoadingHelp={isLoadingHelp}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

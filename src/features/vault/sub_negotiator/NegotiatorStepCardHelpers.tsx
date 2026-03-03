import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, ChevronRight, Globe, Settings, UserPlus, KeyRound,
  ShieldCheck, Copy, HelpCircle, Loader2 } from 'lucide-react';
import type { NegotiationStep } from '@/hooks/design/useCredentialNegotiator';
import { MOTION_TIMING } from '@/features/templates/animationPresets';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { FieldCaptureRow } from '@/features/vault/sub_forms/FieldCaptureRow';

const INFO_STATUS = STATUS_COLORS.info!;
const AI_STATUS = STATUS_COLORS.ai!;
const SUCCESS_STATUS = STATUS_COLORS.success!;
const WARNING_STATUS = STATUS_COLORS.warning!;

/** Convert a snake_case field key to a human-friendly label. */
export function formatFieldLabel(key: string): string {
  const ACRONYMS = new Set(['api', 'url', 'id', 'ssh', 'mcp', 'oauth', 'jwt', 'ip', 'uri']);
  return key
    .split('_')
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export const ACTION_ICONS: Record<string, typeof Globe> = {
  navigate: Globe, configure: Settings, create_account: UserPlus,
  authorize: ShieldCheck, capture: KeyRound, verify: Copy,
};
export const ACTION_COLORS: Record<string, string> = {
  navigate: `${INFO_STATUS.color} ${INFO_STATUS.bgColor} ${INFO_STATUS.borderColor}`,
  configure: `${WARNING_STATUS.color} ${WARNING_STATUS.bgColor} ${WARNING_STATUS.borderColor}`,
  create_account: `${INFO_STATUS.color} ${INFO_STATUS.bgColor} ${INFO_STATUS.borderColor}`,
  authorize: `${AI_STATUS.color} ${AI_STATUS.bgColor} ${AI_STATUS.borderColor}`,
  capture: `${SUCCESS_STATUS.color} ${SUCCESS_STATUS.bgColor} ${SUCCESS_STATUS.borderColor}`,
  verify: `${WARNING_STATUS.color} ${WARNING_STATUS.bgColor} ${WARNING_STATUS.borderColor}`,
};
export interface NegotiatorStepCardProps {
  step: NegotiationStep;
  stepIndex: number;
  isActive: boolean;
  isCompleted: boolean;
  capturedValues: Record<string, string>;
  onComplete: () => void;
  onSelect: () => void;
  onCaptureValue: (fieldKey: string, value: string) => void;
  onRequestHelp: (question: string) => void;
  stepHelp: { answer: string; stepIndex: number } | null;
  isLoadingHelp: boolean;
}
export function StepHeader({ step, stepIndex, isActive, isCompleted, onSelect, colorClasses, Icon }: {
  step: NegotiationStep; stepIndex: number; isActive: boolean; isCompleted: boolean;
  onSelect: () => void; colorClasses: string | undefined; Icon: typeof Globe;
}) {
  return (
    <button onClick={onSelect} className="w-full flex items-center gap-3 px-4 py-3 text-left">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm font-bold border ${
          isCompleted
            ? `${SUCCESS_STATUS.bgColor} ${SUCCESS_STATUS.borderColor} ${SUCCESS_STATUS.color}`
            : isActive
              ? `${AI_STATUS.bgColor} ${AI_STATUS.borderColor} ${AI_STATUS.color}`
              : 'bg-secondary/40 border-primary/15 text-muted-foreground/90'
        }`}
      >
        {isCompleted ? <Check className="w-3.5 h-3.5" /> : stepIndex + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-foreground/90'}`}>
            {step.title}
          </span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm font-medium border ${colorClasses}`}>
            <Icon className="w-2.5 h-2.5" />
            {step.action_type.replace('_', ' ')}
          </span>
          {step.requires_human && (
            <span className="px-1.5 py-0.5 rounded text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20">
              manual
            </span>
          )}
        </div>
        {!isActive && (
          <p className="text-sm text-muted-foreground/80 mt-0.5 truncate">{step.description}</p>
        )}
      </div>
      {isActive
        ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 shrink-0" />
        : <ChevronRight className="w-4 h-4 text-muted-foreground/80 shrink-0" />}
    </button>
  );
}
export function CaptureFieldRow({ fieldKey, hint, stepIndex, capturedValue, onCaptureValue }: {
  fieldKey: string; hint: string; stepIndex: number;
  capturedValue: string; onCaptureValue: (fieldKey: string, value: string) => void;
}) {
  const label = formatFieldLabel(fieldKey);
  return (
    <motion.div
      key={fieldKey}
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      className="space-y-1"
      data-testid={`negotiator-step-${stepIndex}-field-${fieldKey}`}
    >
      <FieldCaptureRow
        source="negotiator"
        mode="editable"
        label={`Paste: ${label}`}
        value={capturedValue || ''}
        onChange={(nextValue) => onCaptureValue(fieldKey, nextValue)}
        placeholder={`Paste ${label} here...`}
        hint={hint}
        inputType="password"
        allowPaste
        allowCopy
        testIdBase={`negotiator-step-${stepIndex}-field-${fieldKey}`}
      />
    </motion.div>
  );
}
export function HelpSection({ stepIndex, onRequestHelp, stepHelp, isLoadingHelp }: {
  stepIndex: number; onRequestHelp: (question: string) => void;
  stepHelp: { answer: string; stepIndex: number } | null; isLoadingHelp: boolean;
}) {
  const [helpQuestion, setHelpQuestion] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const handleAskHelp = () => {
    if (!helpQuestion.trim()) return;
    onRequestHelp(helpQuestion.trim());
    setHelpQuestion('');
  };
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      className="pt-1"
      data-testid={`negotiator-step-${stepIndex}-help-section`}
    >
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/90 hover:text-foreground/95 transition-colors duration-snap"
        data-testid={`negotiator-step-${stepIndex}-help-toggle-btn`}
      >
        <HelpCircle className="w-3 h-3" />
        {showHelp ? 'Hide help' : 'Need help with this step?'}
      </button>
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={MOTION_TIMING.FLOW}
            className="overflow-hidden mt-2 space-y-2"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={helpQuestion}
                onChange={(e) => setHelpQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAskHelp()}
                placeholder="Ask a question about this step..."
                className={`flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 ${AI_STATUS.ringColor!} transition-all`}
                data-testid={`negotiator-step-${stepIndex}-help-input`}
              />
              <button
                onClick={handleAskHelp}
                disabled={!helpQuestion.trim() || isLoadingHelp}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-40 hover:opacity-90 ${AI_STATUS.bgColor} ${AI_STATUS.borderColor} ${AI_STATUS.color}`}
                data-testid={`negotiator-step-${stepIndex}-help-ask-btn`}
              >
                {isLoadingHelp ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Ask'}
              </button>
            </div>
            {stepHelp && stepHelp.stepIndex === stepIndex && (
              <div
                className={`px-3 py-2 rounded-lg text-sm text-foreground/80 ${AI_STATUS.bgColor} border ${AI_STATUS.borderColor}`}
                data-testid={`negotiator-step-${stepIndex}-help-answer`}
              >
                {stepHelp.answer}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

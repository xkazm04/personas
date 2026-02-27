import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ExternalLink,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Settings,
  UserPlus,
  KeyRound,
  Copy,
  ShieldCheck,
  HelpCircle,
  Loader2,
  ClipboardPaste,
} from 'lucide-react';
import { openExternalUrl } from '@/api/tauriApi';
import type { NegotiationStep } from '@/hooks/design/useCredentialNegotiator';

const ACTION_ICONS: Record<string, typeof Globe> = {
  navigate: Globe,
  configure: Settings,
  create_account: UserPlus,
  authorize: ShieldCheck,
  capture: KeyRound,
  verify: Copy,
};

const ACTION_COLORS: Record<string, string> = {
  navigate: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  configure: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  create_account: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  authorize: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  capture: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  verify: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
};

interface NegotiatorStepCardProps {
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

export function NegotiatorStepCard({
  step,
  stepIndex,
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
  const [helpQuestion, setHelpQuestion] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const Icon = ACTION_ICONS[step.action_type] || Globe;
  const colorClasses = ACTION_COLORS[step.action_type] || ACTION_COLORS.navigate;

  const handleOpenUrl = async () => {
    if (!step.url) return;
    try {
      await openExternalUrl(step.url);
    } catch {
      window.open(step.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePasteFromClipboard = async (fieldKey: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onCaptureValue(fieldKey, text.trim());
      }
    } catch {
      // Clipboard access denied — user can paste manually
    }
  };

  const handleAskHelp = () => {
    if (!helpQuestion.trim()) return;
    onRequestHelp(helpQuestion.trim());
    setHelpQuestion('');
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
      className={`rounded-xl border transition-all ${
        isActive
          ? 'border-violet-500/30 bg-violet-500/5 shadow-lg shadow-violet-500/5'
          : isCompleted
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-primary/10 bg-secondary/20'
      }`}
    >
      {/* Step header */}
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Step number / check */}
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-sm font-bold border ${
            isCompleted
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
              : isActive
                ? 'bg-violet-500/20 border-violet-500/30 text-violet-400'
                : 'bg-secondary/40 border-primary/15 text-muted-foreground/90'
          }`}
        >
          {isCompleted ? <Check className="w-3.5 h-3.5" /> : stepIndex + 1}
        </div>

        {/* Title + action badge */}
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
            <p className="text-sm text-muted-foreground/80 mt-0.5 truncate">
              {step.description}
            </p>
          )}
        </div>

        {/* Expand indicator */}
        {isActive ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground/80 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground/80 shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
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
                  className="px-3 py-2 rounded-lg bg-secondary/40 border border-primary/10 text-sm text-foreground/90"
                  data-testid={`negotiator-step-${stepIndex}-visual-hint`}
                >
                  {step.visual_hint}
                </motion.div>
              )}

              {/* URL button */}
              {step.url && (
                <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
                  <button
                    onClick={handleOpenUrl}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm hover:bg-violet-500/20 transition-colors"
                    data-testid={`negotiator-step-${stepIndex}-open-url-btn`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in browser
                    <span className="text-violet-400/50 truncate max-w-[200px]">{step.url}</span>
                  </button>
                </motion.div>
              )}

              {/* Waiting for */}
              {step.wait_for && (
                <motion.div
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
                  data-testid={`negotiator-step-${stepIndex}-wait-for`}
                >
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0 animate-spin" />
                  <span className="text-sm text-amber-200/80">{step.wait_for}</span>
                </motion.div>
              )}

              {/* Capture fields */}
              {step.field_fills && Object.entries(step.field_fills).map(([fieldKey, hint]) => (
                <motion.div
                  key={fieldKey}
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  className="space-y-1.5"
                  data-testid={`negotiator-step-${stepIndex}-field-${fieldKey}`}
                >
                  <label className="text-sm text-foreground/80 font-medium">
                    Paste: {fieldKey.replace(/_/g, ' ')}
                  </label>
                  <p className="text-sm text-muted-foreground/80">{hint}</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={capturedValues[fieldKey] || ''}
                      onChange={(e) => onCaptureValue(fieldKey, e.target.value)}
                      placeholder={`Paste ${fieldKey.replace(/_/g, ' ')} here...`}
                      className="flex-1 px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 transition-all font-mono"
                      data-testid={`negotiator-step-${stepIndex}-field-${fieldKey}-input`}
                    />
                    <button
                      onClick={() => handlePasteFromClipboard(fieldKey)}
                      className="px-3 py-2 rounded-lg bg-secondary/60 border border-primary/15 text-muted-foreground/80 hover:text-foreground hover:bg-secondary transition-colors"
                      title="Paste from clipboard"
                      data-testid={`negotiator-step-${stepIndex}-field-${fieldKey}-paste-btn`}
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}

              {/* Help section */}
              <motion.div
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                className="pt-1"
                data-testid={`negotiator-step-${stepIndex}-help-section`}
              >
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground/90 hover:text-foreground/95 transition-colors"
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
                      className="overflow-hidden mt-2 space-y-2"
                    >
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={helpQuestion}
                          onChange={(e) => setHelpQuestion(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAskHelp()}
                          placeholder="Ask a question about this step..."
                          className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
                          data-testid={`negotiator-step-${stepIndex}-help-input`}
                        />
                        <button
                          onClick={handleAskHelp}
                          disabled={!helpQuestion.trim() || isLoadingHelp}
                          className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-sm hover:bg-violet-500/30 transition-colors disabled:opacity-40"
                          data-testid={`negotiator-step-${stepIndex}-help-ask-btn`}
                        >
                          {isLoadingHelp ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Ask'}
                        </button>
                      </div>

                      {stepHelp && stepHelp.stepIndex === stepIndex && (
                        <div
                          className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-sm text-foreground/80"
                          data-testid={`negotiator-step-${stepIndex}-help-answer`}
                        >
                          {stepHelp.answer}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

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
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid={`negotiator-step-${stepIndex}-complete-btn`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    {step.field_fills ? 'Step complete — values captured' : 'Mark step complete'}
                  </button>
                )}
                {isCompleted && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm"
                    data-testid={`negotiator-step-${stepIndex}-completed-badge`}
                  >
                    <Check className="w-3 h-3" />
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

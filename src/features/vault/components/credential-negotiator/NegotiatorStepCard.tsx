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
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border ${
            isCompleted
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
              : isActive
                ? 'bg-violet-500/20 border-violet-500/30 text-violet-400'
                : 'bg-secondary/40 border-primary/15 text-muted-foreground/50'
          }`}
        >
          {isCompleted ? <Check className="w-3.5 h-3.5" /> : stepIndex + 1}
        </div>

        {/* Title + action badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-foreground/70'}`}>
              {step.title}
            </span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${colorClasses}`}>
              <Icon className="w-2.5 h-2.5" />
              {step.action_type.replace('_', ' ')}
            </span>
            {step.requires_human && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20">
                manual
              </span>
            )}
          </div>
          {!isActive && (
            <p className="text-xs text-muted-foreground/40 mt-0.5 truncate">
              {step.description}
            </p>
          )}
        </div>

        {/* Expand indicator */}
        {isActive ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
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
            <div className="px-4 pb-4 space-y-3">
              {/* Description */}
              <p className="text-sm text-foreground/80">{step.description}</p>

              {/* Visual hint */}
              {step.visual_hint && (
                <div className="px-3 py-2 rounded-lg bg-secondary/40 border border-primary/10 text-xs text-foreground/70">
                  {step.visual_hint}
                </div>
              )}

              {/* URL button */}
              {step.url && (
                <button
                  onClick={handleOpenUrl}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs hover:bg-violet-500/20 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in browser
                  <span className="text-violet-400/50 truncate max-w-[200px]">{step.url}</span>
                </button>
              )}

              {/* Waiting for */}
              {step.wait_for && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0 animate-spin" />
                  <span className="text-xs text-amber-200/80">{step.wait_for}</span>
                </div>
              )}

              {/* Capture fields */}
              {step.field_fills && Object.entries(step.field_fills).map(([fieldKey, hint]) => (
                <div key={fieldKey} className="space-y-1.5">
                  <label className="text-xs text-foreground/60 font-medium">
                    Paste: {fieldKey.replace(/_/g, ' ')}
                  </label>
                  <p className="text-[11px] text-muted-foreground/40">{hint}</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={capturedValues[fieldKey] || ''}
                      onChange={(e) => onCaptureValue(fieldKey, e.target.value)}
                      placeholder={`Paste ${fieldKey.replace(/_/g, ' ')} here...`}
                      className="flex-1 px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 transition-all font-mono"
                    />
                    <button
                      onClick={() => handlePasteFromClipboard(fieldKey)}
                      className="px-3 py-2 rounded-lg bg-secondary/60 border border-primary/15 text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                      title="Paste from clipboard"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Help section */}
              <div className="pt-1">
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground/70 transition-colors"
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
                          className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-foreground text-xs placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
                        />
                        <button
                          onClick={handleAskHelp}
                          disabled={!helpQuestion.trim() || isLoadingHelp}
                          className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs hover:bg-violet-500/30 transition-colors disabled:opacity-40"
                        >
                          {isLoadingHelp ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Ask'}
                        </button>
                      </div>

                      {stepHelp && stepHelp.stepIndex === stepIndex && (
                        <div className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-foreground/80">
                          {stepHelp.answer}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                {!isCompleted && (
                  <button
                    onClick={onComplete}
                    disabled={step.field_fills ? !allFieldsCaptured : false}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {step.field_fills ? 'Step complete — values captured' : 'Mark step complete'}
                  </button>
                )}
                {isCompleted && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs">
                    <Check className="w-3 h-3" />
                    Completed
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

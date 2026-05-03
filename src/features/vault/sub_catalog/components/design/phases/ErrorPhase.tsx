import { AlertTriangle, Lightbulb, RefreshCw, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { Translations } from '@/i18n/en';

interface ErrorPhaseProps {
  error: string | null;
  instruction?: string;
  onRetry: () => void;
  onStartOver: () => void;
}

/** Produce 2-3 contextual recovery tips based on error + instruction. */
function recoveryTips(error: string | null, instruction: string | undefined, t: Translations): string[] {
  const tips: string[] = [];
  const dh = t.vault.design_helpers;
  const raw = error ?? '';
  const input = (instruction ?? '').toLowerCase();

  if (raw.includes('Failed to extract connector design') || raw.includes('Failed to generate')) {
    if (input.length < 10) {
      tips.push(dh.tip_too_short);
    }
    if (!input.includes('api') && !input.includes('key') && !input.includes('token') && !input.includes('oauth') && !input.includes('secret')) {
      tips.push(dh.tip_missing_credential_type);
    }
    tips.push(dh.tip_specific_service);
  }

  if (raw.includes('timed out')) {
    tips.push(dh.tip_simpler_description);
    tips.push(dh.tip_internet_check);
  }

  if (raw.includes('Claude CLI not found')) {
    tips.push(dh.tip_install_cli);
    tips.push(dh.tip_restart_app);
  }

  // Generic fallback
  if (tips.length === 0) {
    tips.push(dh.tip_rephrase);
    tips.push(dh.tip_simpler_first);
  }

  return tips;
}

export function ErrorPhase({ error, instruction, onRetry, onStartOver }: ErrorPhaseProps) {
  const { t } = useTranslation();
  const dm = t.vault.design_modal;
  // Friendly message + suggestion come from the i18n error registry. The
  // 6 patterns this component used to map by hand (Failed to extract,
  // timed out, Claude CLI not found, CLAUDECODE env, Claude CLI exited,
  // generic fallback) are already covered by ERROR_KEY_MAP in
  // src/i18n/useTranslatedError.ts.
  const { message: friendly } = resolveErrorTranslated(t, error);
  const tips = recoveryTips(error, instruction, t);
  const hasInstruction = Boolean(instruction?.trim());

  return (
    <div
      key="error"
      className="animate-fade-slide-in space-y-4"
    >
      {/* Error message */}
      <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-modal">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
        <div>
          <p className="typo-body text-red-300">{friendly}</p>
          {friendly !== error && error && (
            <details className="mt-2">
              <summary className="typo-body text-red-400/40 cursor-pointer hover:text-red-400/60 transition-colors">
                {dm.technical_details}
              </summary>
              <p className="mt-1 typo-code text-red-400/30 font-mono break-all">
                {error}
              </p>
            </details>
          )}
        </div>
      </div>

      {/* Recovery tips */}
      <div className="px-4 py-3 bg-amber-500/5 border border-amber-500/15 rounded-modal space-y-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          <span className="typo-body font-medium text-amber-300/80">{dm.how_to_fix}</span>
        </div>
        <ul className="space-y-1.5 pl-6">
          {tips.map((tip, i) => (
            <li key={i} className="typo-body text-foreground list-disc">{tip}</li>
          ))}
        </ul>
      </div>

      {/* Show preserved instruction */}
      {hasInstruction && (
        <div className="px-4 py-2.5 bg-secondary/30 border border-primary/10 rounded-modal">
          <p className="typo-body text-foreground mb-1">{dm.original_request}</p>
          <p className="typo-body text-foreground/90 italic">"{instruction}"</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onStartOver}
          className="flex items-center gap-1.5 px-3 py-2 text-foreground hover:text-foreground/95 typo-body transition-colors"
        >
          <X className="w-3 h-3" />
          {dm.start_over}
        </button>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-foreground rounded-modal typo-body font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {hasInstruction ? dm.try_again_with : t.common.try_again}
        </button>
      </div>
    </div>
  );
}

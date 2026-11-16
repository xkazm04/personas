import { AlertTriangle, Lightbulb, RefreshCw, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { Translations } from '@/i18n/en';
import Button from '@/features/shared/components/buttons/Button';

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
      <div className="flex items-start gap-3 px-4 py-3 bg-status-error/10 border border-status-error/20 rounded-modal">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-status-error shrink-0" />
        <div>
          <p className="typo-body text-status-error">{friendly}</p>
          {friendly !== error && error && (
            <details className="mt-2">
              <summary className="typo-body text-status-error/40 cursor-pointer hover:text-status-error/60 transition-colors">
                {dm.technical_details}
              </summary>
              <p className="mt-1 typo-code text-status-error/30 break-all">
                {error}
              </p>
            </details>
          )}
        </div>
      </div>

      {/* Recovery tips */}
      <div className="px-4 py-3 bg-status-warning/5 border border-status-warning/15 rounded-modal space-y-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-status-warning" />
          <span className="typo-body text-status-warning/80">{dm.how_to_fix}</span>
        </div>
        <ul className="space-y-1.5 pl-6">
          {tips.map((tip, i) => (
            <li key={i} className="typo-body text-foreground list-disc">{tip}</li>
          ))}
        </ul>
      </div>

      {/* Show preserved instruction */}
      {hasInstruction && (
        <div className="px-4 py-2.5 bg-surface-1 border border-hair rounded-modal">
          <p className="typo-body text-foreground mb-1">{dm.original_request}</p>
          <p className="typo-body text-ink-1 italic">"{instruction}"</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          onClick={onStartOver}
          variant="ghost"
          size="md"
          icon={<X className="w-3 h-3" />}
        >
          {dm.start_over}
        </Button>
        <Button
          type="button"
          onClick={onRetry}
          variant="secondary"
          size="md"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          {hasInstruction ? dm.try_again_with : t.common.try_again}
        </Button>
      </div>
    </div>
  );
}

import { AlertTriangle, Lightbulb, RefreshCw, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface ErrorPhaseProps {
  error: string | null;
  instruction?: string;
  onRetry: () => void;
  onStartOver: () => void;
}

/** Map raw backend errors to user-friendly messages. */
function friendlyError(raw: string | null): string {
  if (!raw) return 'An unexpected error occurred.';

  if (raw.includes('Failed to extract connector design'))
    return 'The AI could not generate a valid connector from your description.';
  if (raw.includes('timed out'))
    return 'The request took too long and was stopped. This can happen with very broad requests.';
  if (raw.includes('Claude CLI not found'))
    return 'Claude CLI is not installed on this system.';
  if (raw.includes('CLAUDECODE environment variable'))
    return 'A conflicting environment variable is blocking the CLI. Restart the app to fix this automatically.';
  if (raw.includes('Claude CLI exited with error'))
    return 'The AI backend returned an unexpected error.';

  return raw;
}

/** Produce 2-3 contextual recovery tips based on error + instruction. */
function recoveryTips(error: string | null, instruction: string | undefined): string[] {
  const tips: string[] = [];
  const raw = error ?? '';
  const input = (instruction ?? '').toLowerCase();

  if (raw.includes('Failed to extract connector design') || raw.includes('Failed to generate')) {
    if (input.length < 10) {
      tips.push('Your description was quite short. Try being more specific -- e.g. "GitHub personal access token" instead of "GitHub".');
    }
    if (!input.includes('api') && !input.includes('key') && !input.includes('token') && !input.includes('oauth') && !input.includes('secret')) {
      tips.push('Include the credential type -- e.g. "API key", "OAuth", "bot token", or "secret key".');
    }
    tips.push('Mention the specific service or product name clearly (e.g. "Stripe" rather than "payment processor").');
  }

  if (raw.includes('timed out')) {
    tips.push('Try a simpler, more targeted description to speed up analysis.');
    tips.push('Check your internet connection -- the AI needs to reach Anthropic servers.');
  }

  if (raw.includes('Claude CLI not found')) {
    tips.push('Install the Claude CLI: https://docs.anthropic.com/en/docs/claude-code');
    tips.push('After installing, restart the app and try again.');
  }

  // Generic fallback
  if (tips.length === 0) {
    tips.push('Try rephrasing your request with the service name and credential type.');
    tips.push('If the issue persists, try a simpler description first, then add details.');
  }

  return tips;
}

export function ErrorPhase({ error, instruction, onRetry, onStartOver }: ErrorPhaseProps) {
  const { t } = useTranslation();
  const friendly = friendlyError(error);
  const tips = recoveryTips(error, instruction);
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
                Technical details
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
          <span className="typo-body font-medium text-amber-300/80">{t.vault.design_modal.how_to_fix}</span>
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
          <p className="typo-body text-foreground mb-1">{t.vault.design_modal.original_request}</p>
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
          Start over
        </button>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-foreground rounded-modal typo-body font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {hasInstruction ? t.vault.design_modal.try_again_with : t.common.try_again}
        </button>
      </div>
    </div>
  );
}

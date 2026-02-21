import { motion } from 'framer-motion';
import { AlertTriangle, Lightbulb, RefreshCw, X } from 'lucide-react';

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
      tips.push('Your description was quite short. Try being more specific — e.g. "GitHub personal access token" instead of "GitHub".');
    }
    if (!input.includes('api') && !input.includes('key') && !input.includes('token') && !input.includes('oauth') && !input.includes('secret')) {
      tips.push('Include the credential type — e.g. "API key", "OAuth", "bot token", or "secret key".');
    }
    tips.push('Mention the specific service or product name clearly (e.g. "Stripe" rather than "payment processor").');
  }

  if (raw.includes('timed out')) {
    tips.push('Try a simpler, more targeted description to speed up analysis.');
    tips.push('Check your internet connection — the AI needs to reach Anthropic servers.');
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
  const friendly = friendlyError(error);
  const tips = recoveryTips(error, instruction);
  const hasInstruction = Boolean(instruction?.trim());

  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Error message */}
      <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
        <div>
          <p className="text-sm text-red-300">{friendly}</p>
          {friendly !== error && error && (
            <details className="mt-2">
              <summary className="text-[11px] text-red-400/40 cursor-pointer hover:text-red-400/60 transition-colors">
                Technical details
              </summary>
              <p className="mt-1 text-[11px] text-red-400/30 font-mono break-all">
                {error}
              </p>
            </details>
          )}
        </div>
      </div>

      {/* Recovery tips */}
      <div className="px-4 py-3 bg-amber-500/5 border border-amber-500/15 rounded-xl space-y-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-300/80">How to fix this</span>
        </div>
        <ul className="space-y-1.5 pl-6">
          {tips.map((tip, i) => (
            <li key={i} className="text-xs text-foreground/60 list-disc">{tip}</li>
          ))}
        </ul>
      </div>

      {/* Show preserved instruction */}
      {hasInstruction && (
        <div className="px-4 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl">
          <p className="text-[11px] text-muted-foreground/40 mb-1">Your original request (preserved):</p>
          <p className="text-xs text-foreground/70 italic">"{instruction}"</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onStartOver}
          className="flex items-center gap-1.5 px-3 py-2 text-muted-foreground/40 hover:text-foreground/60 text-xs transition-colors"
        >
          <X className="w-3 h-3" />
          Start over
        </button>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-foreground/80 rounded-xl text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {hasInstruction ? 'Try again with your request' : 'Try Again'}
        </button>
      </div>
    </motion.div>
  );
}

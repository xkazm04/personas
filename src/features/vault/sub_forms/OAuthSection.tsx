import { CheckCircle, Shield } from 'lucide-react';

interface OAuthSectionProps {
  onConsent: () => void;
  consentLabel?: string;
  consentHint?: string;
  consentDisabled?: boolean;
  consentSuccessBadge?: string;
}

export function OAuthSection({
  onConsent,
  consentLabel,
  consentHint,
  consentDisabled,
  consentSuccessBadge,
}: OAuthSectionProps) {
  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Authentication
        </h4>
        <button
          onClick={onConsent}
          type="button"
          disabled={consentDisabled}
          className="flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/25 text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Shield className="w-4 h-4" />
          {consentLabel || 'Authorize with Google'}
        </button>
        {consentHint && (
          <p className="mt-1.5 text-sm text-muted-foreground/60">{consentHint}</p>
        )}
        {consentSuccessBadge && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm">
            <CheckCircle className="w-3.5 h-3.5" />
            {consentSuccessBadge}
          </div>
        )}
      </div>
    </>
  );
}

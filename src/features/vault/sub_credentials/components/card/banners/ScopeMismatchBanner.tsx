import { ShieldAlert } from 'lucide-react';

interface ScopeMismatchBannerProps {
  requestedScopes: string;
  grantedScopes: string;
  providerLabel: string;
  onReauthorize?: () => void;
}

export function ScopeMismatchBanner({
  requestedScopes,
  grantedScopes,
  providerLabel: _providerLabel,
  onReauthorize,
}: ScopeMismatchBannerProps) {
  const requested = new Set(requestedScopes.split(/[\s,]+/).filter(Boolean));
  const granted = new Set(grantedScopes.split(/[\s,]+/).filter(Boolean));
  const missing = [...requested].filter((s) => !granted.has(s));

  if (missing.length === 0) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-card bg-amber-500/8 border border-amber-500/20">
      <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-amber-300/90 font-medium">
          Scope mismatch
        </p>
        <p className="text-xs text-amber-300/60 mt-0.5">
          {missing.length} requested scope{missing.length !== 1 ? 's' : ''} not granted:{' '}
          <span className="font-mono">{missing.join(', ')}</span>
        </p>
        {onReauthorize && (
          <button
            type="button"
            onClick={onReauthorize}
            className="mt-1.5 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
          >
            Re-authorize with additional scopes
          </button>
        )}
      </div>
    </div>
  );
}

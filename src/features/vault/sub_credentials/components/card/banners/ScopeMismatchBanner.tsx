import { ShieldAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t, tx } = useTranslation();
  const card = t.vault.card;
  const requested = new Set(requestedScopes.split(/[\s,]+/).filter(Boolean));
  const granted = new Set(grantedScopes.split(/[\s,]+/).filter(Boolean));
  const missing = [...requested].filter((s) => !granted.has(s));

  if (missing.length === 0) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-card bg-status-warning/8 border border-status-warning/20">
      <ShieldAlert className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="typo-caption text-status-warning/90">
          {card.scope_mismatch}
        </p>
        <p className="typo-caption text-status-warning/60 mt-0.5">
          {tx(missing.length === 1 ? card.scope_missing_one : card.scope_missing_other, { count: missing.length })}
          <span className="font-mono">{missing.join(', ')}</span>
        </p>
        {onReauthorize && (
          <button
            type="button"
            onClick={onReauthorize}
            className="mt-1.5 typo-caption text-status-warning hover:text-status-warning underline underline-offset-2 transition-colors"
          >
            {card.reauthorize_scopes}
          </button>
        )}
      </div>
    </div>
  );
}

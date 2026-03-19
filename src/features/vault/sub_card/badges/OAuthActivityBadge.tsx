import { useState } from 'react';
import { RefreshCw, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { formatTimestamp } from '@/lib/utils/formatters';
import { refreshCredentialOAuthNow } from '@/api/vault/rotation';

interface OAuthActivityBadgeProps {
  credentialId: string;
  oauthRefreshCount: number;
  oauthLastRefreshAt: string | null;
  oauthTokenExpiresAt: string | null;
  onRefreshed?: () => void;
}

function getExpiryStatus(expiresAt: string | null): {
  label: string;
  color: string;
  urgent: boolean;
} {
  if (!expiresAt) return { label: 'Unknown', color: 'text-muted-foreground/50', urgent: false };

  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  const remaining = exp - now;

  if (remaining <= 0) return { label: 'Expired', color: 'text-red-400', urgent: true };
  if (remaining < 600_000) return { label: '<10m', color: 'text-red-400', urgent: true };
  if (remaining < 3_600_000) return { label: '<1h', color: 'text-amber-400', urgent: true };
  const hours = Math.floor(remaining / 3_600_000);
  if (hours < 24) return { label: `${hours}h`, color: 'text-emerald-400', urgent: false };
  const days = Math.floor(hours / 24);
  return { label: `${days}d`, color: 'text-emerald-400', urgent: false };
}

export function OAuthActivityBadge({
  credentialId,
  oauthRefreshCount,
  oauthLastRefreshAt,
  oauthTokenExpiresAt,
  onRefreshed,
}: OAuthActivityBadgeProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const expiry = getExpiryStatus(oauthTokenExpiresAt);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshCredentialOAuthNow(credentialId);
      onRefreshed?.();
    } catch {
      // Refresh failed silently -- badge will still show old status
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {oauthTokenExpiresAt && (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary/40 border border-primary/10 shrink-0`}
          title={`Token expires: ${oauthTokenExpiresAt}\nLast refresh: ${oauthLastRefreshAt ?? 'Never'}`}
        >
          <Clock className={`w-2.5 h-2.5 ${expiry.color}`} />
          <span className={`text-xs font-mono ${expiry.color}`}>{expiry.label}</span>
        </span>
      )}
      {expiry.urgent && (
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50 shrink-0"
          title="Refresh OAuth token now"
        >
          {isRefreshing ? (
            <LoadingSpinner size="xs" className="w-2.5 h-2.5" />
          ) : (
            <RefreshCw className="w-2.5 h-2.5" />
          )}
          <span className="text-xs font-medium">Refresh</span>
        </button>
      )}
      {oauthRefreshCount > 0 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary/40 border border-primary/10 text-muted-foreground/50 shrink-0"
          title={`${oauthRefreshCount} token refresh${oauthRefreshCount !== 1 ? 'es' : ''}\nLast: ${formatTimestamp(oauthLastRefreshAt, 'Never')}`}
        >
          <RefreshCw className="w-2.5 h-2.5" />
          <span className="text-xs font-mono">{oauthRefreshCount}</span>
        </span>
      )}
    </div>
  );
}

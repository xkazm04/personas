import { RefreshCw, Clock } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils/formatters';

interface OAuthActivityBadgeProps {
  oauthRefreshCount: number;
  oauthLastRefreshAt: string | null;
  oauthTokenExpiresAt: string | null;
}

function getExpiryStatus(expiresAt: string | null): {
  label: string;
  color: string;
} {
  if (!expiresAt) return { label: 'Unknown', color: 'text-muted-foreground/50' };

  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  const remaining = exp - now;

  if (remaining <= 0) return { label: 'Expired', color: 'text-red-400' };
  if (remaining < 600_000) return { label: '<10m', color: 'text-red-400' };
  if (remaining < 3_600_000) return { label: '<1h', color: 'text-amber-400' };
  const hours = Math.floor(remaining / 3_600_000);
  if (hours < 24) return { label: `${hours}h`, color: 'text-emerald-400' };
  const days = Math.floor(hours / 24);
  return { label: `${days}d`, color: 'text-emerald-400' };
}

export function OAuthActivityBadge({
  oauthRefreshCount,
  oauthLastRefreshAt,
  oauthTokenExpiresAt,
}: OAuthActivityBadgeProps) {
  const expiry = getExpiryStatus(oauthTokenExpiresAt);

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

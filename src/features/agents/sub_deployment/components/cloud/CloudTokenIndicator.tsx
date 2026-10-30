import { Check, X, AlertTriangle, HelpCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CloudOAuthStatusResponse } from '@/api/system/cloud';

export type CloudTokenState = 'missing' | 'expired' | 'unknown' | 'valid';

/**
 * Presence is not authorization. `hasClaudeToken` only says a token exists on
 * the orchestrator; whether it still works is the OAuth status, which the
 * OAuth tab already renders three-valued (isExpired true / false / null).
 * Only a verified-unexpired token reads green here.
 */
export function cloudTokenState(hasClaudeToken: boolean, oauth: CloudOAuthStatusResponse | null | undefined): CloudTokenState {
  if (!hasClaudeToken) return 'missing';
  if (oauth?.connected && oauth.isExpired === true) return 'expired';
  if (oauth?.connected && oauth.isExpired === false) return 'valid';
  return 'unknown';
}

const LOOK: Record<CloudTokenState, { icon: typeof Check; ring: string; ink: string }> = {
  valid: { icon: Check, ring: 'bg-status-success/20', ink: 'text-status-success' },
  expired: { icon: AlertTriangle, ring: 'bg-status-warning/20', ink: 'text-status-warning' },
  unknown: { icon: HelpCircle, ring: 'bg-secondary/60', ink: 'text-foreground' },
  missing: { icon: X, ring: 'bg-status-error/20', ink: 'text-status-error' },
};

export function CloudTokenIndicator({ hasClaudeToken, oauthStatus }: {
  hasClaudeToken: boolean;
  oauthStatus: CloudOAuthStatusResponse | null | undefined;
}) {
  const { t } = useTranslation();
  const dt = t.deployment;
  const state = cloudTokenState(hasClaudeToken, oauthStatus);
  const label = {
    valid: dt.status.token_available,
    expired: dt.oauth_panel.token_expired,
    unknown: dt.oauth_panel.token_unknown,
    missing: dt.status.no_token_configured,
  }[state];
  const { icon: Icon, ring, ink } = LOOK[state];

  return (
    <div
      data-testid="cloud-status-token"
      data-token-state={state}
      className="flex items-center gap-2 p-3 rounded-card bg-secondary/30 border border-primary/10"
    >
      <div className={`w-5 h-5 rounded-full ${ring} flex items-center justify-center`}>
        <Icon className={`w-3 h-3 ${ink}`} strokeWidth={3} aria-hidden="true" />
      </div>
      <span className="typo-body text-foreground">{label}</span>
    </div>
  );
}

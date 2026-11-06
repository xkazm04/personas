import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw, ExternalLink, Shield, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { formatTimestamp } from '@/lib/utils/formatters';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';

export interface CloudOAuthPanelProps {
  oauthStatus: { connected: boolean; scopes: string[] | null; expiresAt: string | null; isExpired: boolean | null } | null;
  pendingOAuthState: string | null;
  oauthStartUrl: string | null;
  oauthCode: string;
  setOauthCode: (v: string) => void;
  onStartOAuth: () => void;
  onCompleteOAuth: () => void;
  onCancelOAuth: () => void;
  onRefreshOAuth: () => void;
  onDisconnectOAuth: () => void;
}

export function CloudOAuthPanel({
  oauthStatus,
  pendingOAuthState,
  oauthStartUrl,
  oauthCode,
  setOauthCode,
  onStartOAuth,
  onCompleteOAuth,
  onCancelOAuth,
  onRefreshOAuth,
  onDisconnectOAuth,
}: CloudOAuthPanelProps) {
  const { t, tx } = useTranslation();
  const dt = t.deployment.oauth_panel;

  // State: waiting for callback
  if (pendingOAuthState) {
    return (
      <div className={`max-w-md ${DEPLOYMENT_TOKENS.panelSpacing}`}>
        <div className="p-4 rounded-card bg-role-agent/5 border border-role-agent/15">
          <p className="typo-body text-ink-1">
            {dt.open_auth_instruction}
          </p>
          {sanitizeExternalUrl(oauthStartUrl) && (
            <a
              href={sanitizeExternalUrl(oauthStartUrl)!}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 typo-body text-role-agent hover:text-role-agent"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {dt.open_auth_window}
            </a>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="oauth-code" className="typo-body text-ink-1">{t.deployment.auth_code}</label>
          <input
            id="oauth-code"
            type="text"
            value={oauthCode}
            onChange={(e) => setOauthCode(e.target.value)}
            placeholder={dt.paste_code}
            className="w-full px-3 py-2 typo-body rounded-modal bg-surface-2 border border-hair text-ink-1 placeholder:text-ink-3 focus-visible:outline-none focus-visible:border-role-agent/40 transition-colors"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCompleteOAuth}
            disabled={!oauthCode.trim()}
            className="flex items-center gap-2 px-4 py-2 typo-body rounded-modal bg-role-agent text-ink-1 hover:bg-role-agent disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {dt.complete_authorization}
          </button>
          <button
            type="button"
            onClick={onCancelOAuth}
            className="px-4 py-2 typo-body rounded-modal bg-surface-2 border border-hair text-ink-1 hover:text-ink-1 hover:border-primary/25 transition-colors cursor-pointer"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  // State: connected
  if (oauthStatus?.connected) {
    // isExpired: true = confirmed expired, false = confirmed valid, null = not checked
    const isExpired = oauthStatus.isExpired === true;
    const isUnknown = oauthStatus.isExpired === null;

    const StatusIcon = isExpired ? ShieldX : isUnknown ? ShieldAlert : ShieldCheck;
    const statusBg = isExpired
      ? 'bg-status-warning/10 border border-status-warning/25'
      : isUnknown
        ? 'bg-surface-2 border border-hair'
        : `${DEPLOYMENT_TOKENS.connectedBg} border ${DEPLOYMENT_TOKENS.connectedBorder}`;
    const statusColor = isExpired ? 'text-status-warning' : isUnknown ? 'text-ink-3' : 'text-status-success';
    const statusTextColor = isExpired ? 'text-status-warning' : isUnknown ? 'text-ink-3' : 'text-status-success';
    const statusLabel = isExpired
      ? dt.token_expired
      : isUnknown
        ? dt.token_unknown
        : dt.token_connected;

    return (
      <div className={DEPLOYMENT_TOKENS.panelSpacing}>
        <div className={`flex items-center gap-3 p-4 ${DEPLOYMENT_TOKENS.cardRadius} ${statusBg}`}>
          <StatusIcon className={`w-5 h-5 ${statusColor}`} />
          <div>
            <p className={`typo-body ${statusTextColor}`}>
              {statusLabel}
            </p>
          </div>
        </div>

        {isExpired && (
          <div className="p-4 rounded-card bg-status-warning/10 border border-status-warning/25">
            <p className="typo-body text-status-warning">
              {`${dt.token_expired_msg_prefix}${oauthStatus.expiresAt ? ` ${tx(dt.expired_at, { time: formatTimestamp(oauthStatus.expiresAt) })}` : ''}`}
            </p>
          </div>
        )}

        {isUnknown && (
          <div className="p-4 rounded-card bg-surface-2 border border-hair">
            <p className="typo-body text-ink-3">
              {dt.token_unknown_msg}
            </p>
          </div>
        )}

        {/* Scopes */}
        {oauthStatus.scopes && oauthStatus.scopes.length > 0 && (
          <div>
            <SectionHeading className={DEPLOYMENT_TOKENS.sectionHeadingGap}>{dt.scopes}</SectionHeading>
            <div className="flex flex-wrap gap-2">
              {oauthStatus.scopes.map((scope) => (
                <span
                  key={scope}
                  className="inline-flex items-center typo-body text-ink-1"
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Expiry */}
        {oauthStatus.expiresAt && (
          <div>
            <SectionHeading className={DEPLOYMENT_TOKENS.sectionHeadingGap}>{dt.expires}</SectionHeading>
            <p className="typo-body text-ink-1">
              <AbsoluteTime timestamp={oauthStatus.expiresAt} />
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onRefreshOAuth}
            className="flex items-center gap-2 px-4 py-2 typo-body rounded-modal bg-surface-2 border border-hair text-ink-1 hover:text-ink-1 hover:border-primary/25 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {dt.refresh_token}
          </button>
          <button
            type="button"
            onClick={onDisconnectOAuth}
            className="flex items-center gap-2 px-4 py-2 typo-body rounded-modal bg-status-error/10 border border-status-error/20 text-status-error hover:bg-status-error/20 transition-colors cursor-pointer"
          >
            <ShieldX className="w-3.5 h-3.5" />
            {t.deployment.connection.disconnect}
          </button>
        </div>
      </div>
    );
  }

  // State: not connected
  return (
    <div className={`max-w-md ${DEPLOYMENT_TOKENS.panelSpacing}`}>
      <div className="flex flex-col items-center text-center py-8">
        <Shield className="w-10 h-10 text-ink-1 mb-4" />
        <p className="typo-body text-ink-1">
          {dt.connect_anthropic_msg}
        </p>
      </div>

      <button
        type="button"
        onClick={onStartOAuth}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 typo-body rounded-modal bg-role-agent text-ink-1 hover:bg-role-agent transition-colors cursor-pointer"
      >
        <ExternalLink className="w-4 h-4" />
        {oauthStartUrl ? dt.refresh_auth_link : dt.connect_anthropic}
      </button>
      {sanitizeExternalUrl(oauthStartUrl) && (
        <a
          href={sanitizeExternalUrl(oauthStartUrl)!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 typo-body rounded-modal bg-role-agent/10 border border-role-agent/25 text-role-agent hover:bg-role-agent/15 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          {dt.open_authorization_window}
        </a>
      )}
    </div>
  );
}

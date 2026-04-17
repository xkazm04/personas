import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw, ExternalLink, Shield, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
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
  const { t } = useTranslation();
  const dt = t.deployment.oauth_panel;

  // State: waiting for callback
  if (pendingOAuthState) {
    return (
      <div className={`max-w-md ${DEPLOYMENT_TOKENS.panelSpacing}`}>
        <div className="p-4 rounded-card bg-indigo-500/5 border border-indigo-500/15">
          <p className="text-sm text-foreground/80 leading-relaxed">
            {dt.open_auth_instruction}
          </p>
          {sanitizeExternalUrl(oauthStartUrl) && (
            <a
              href={sanitizeExternalUrl(oauthStartUrl)!}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-300 hover:text-indigo-200"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open authorization window
            </a>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="oauth-code" className="text-sm font-medium text-muted-foreground/80">{t.deployment.auth_code}</label>
          <input
            id="oauth-code"
            type="text"
            value={oauthCode}
            onChange={(e) => setOauthCode(e.target.value)}
            placeholder={dt.paste_code}
            className="w-full px-3 py-2 text-sm rounded-modal bg-secondary/40 border border-primary/15 text-foreground/80 placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onCompleteOAuth}
            disabled={!oauthCode.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-modal bg-indigo-500 text-foreground hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            Complete Authorization
          </button>
          <button
            onClick={onCancelOAuth}
            className="px-4 py-2 text-sm font-medium rounded-modal bg-secondary/40 border border-primary/15 text-foreground/90 hover:text-foreground/95 hover:border-primary/25 transition-colors cursor-pointer"
          >
            Cancel
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
      ? 'bg-amber-500/10 border border-amber-500/25'
      : isUnknown
        ? 'bg-slate-500/10 border border-slate-500/25'
        : `${DEPLOYMENT_TOKENS.connectedBg} border ${DEPLOYMENT_TOKENS.connectedBorder}`;
    const statusColor = isExpired ? 'text-amber-400' : isUnknown ? 'text-slate-400' : 'text-emerald-400';
    const statusTextColor = isExpired ? 'text-amber-300' : isUnknown ? 'text-slate-300' : 'text-emerald-400';
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
            <p className={`text-sm font-medium ${statusTextColor}`}>
              {statusLabel}
            </p>
          </div>
        </div>

        {isExpired && (
          <div className="p-4 rounded-card bg-amber-500/10 border border-amber-500/25">
            <p className="text-sm text-amber-200/90 leading-relaxed">
              This OAuth token has expired{oauthStatus.expiresAt ? ` (expired ${new Date(oauthStatus.expiresAt).toLocaleString()})` : ''}. Refresh now to restore cloud execution access.
            </p>
          </div>
        )}

        {isUnknown && (
          <div className="p-4 rounded-card bg-slate-500/10 border border-slate-500/25">
            <p className="text-sm text-slate-300/90 leading-relaxed">
              Token validity could not be verified. Refresh the token to confirm it is still active.
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
                  className="text-sm px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/15 text-muted-foreground/80"
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
            <p className="text-sm text-foreground/90">
              {new Date(oauthStatus.expiresAt).toLocaleString()}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onRefreshOAuth}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-modal bg-secondary/40 border border-primary/15 text-foreground/90 hover:text-foreground/95 hover:border-primary/25 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Token
          </button>
          <button
            onClick={onDisconnectOAuth}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-modal bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            <ShieldX className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // State: not connected
  return (
    <div className={`max-w-md ${DEPLOYMENT_TOKENS.panelSpacing}`}>
      <div className="flex flex-col items-center text-center py-8">
        <Shield className="w-10 h-10 text-muted-foreground/80 mb-4" />
        <p className="text-sm text-muted-foreground/80 leading-relaxed">
          Connect your Anthropic account to enable OAuth-based authentication
          for cloud executions.
        </p>
      </div>

      <button
        onClick={onStartOAuth}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded-modal bg-indigo-500 text-foreground hover:bg-indigo-600 transition-colors cursor-pointer"
      >
        <ExternalLink className="w-4 h-4" />
        {oauthStartUrl ? dt.refresh_auth_link : dt.connect_anthropic}
      </button>
      {sanitizeExternalUrl(oauthStartUrl) && (
        <a
          href={sanitizeExternalUrl(oauthStartUrl)!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded-modal bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/15 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Open Authorization Window
        </a>
      )}
    </div>
  );
}

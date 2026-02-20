import { RefreshCw, ExternalLink, Shield, ShieldCheck, ShieldX } from 'lucide-react';

export interface CloudOAuthPanelProps {
  oauthStatus: { connected: boolean; scopes: string[] | null; expiresAt: string | null; isExpired: boolean | null } | null;
  pendingOAuthState: string | null;
  oauthCode: string;
  setOauthCode: (v: string) => void;
  onStartOAuth: () => void;
  onCompleteOAuth: () => void;
  onRefreshOAuth: () => void;
  onDisconnectOAuth: () => void;
}

export function CloudOAuthPanel({
  oauthStatus,
  pendingOAuthState,
  oauthCode,
  setOauthCode,
  onStartOAuth,
  onCompleteOAuth,
  onRefreshOAuth,
  onDisconnectOAuth,
}: CloudOAuthPanelProps) {
  // State: waiting for callback
  if (pendingOAuthState) {
    return (
      <div className="space-y-5 max-w-md">
        <div className="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/15">
          <p className="text-sm text-foreground/80 leading-relaxed">
            A browser window should have opened for authorization. After approving access,
            paste the authorization code below to complete the connection.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground/60">Authorization Code</label>
          <input
            type="text"
            value={oauthCode}
            onChange={(e) => setOauthCode(e.target.value)}
            placeholder="Paste the code here"
            className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-indigo-500/40 transition-colors"
          />
        </div>

        <button
          onClick={onCompleteOAuth}
          disabled={!oauthCode.trim()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-500 text-foreground hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Complete Authorization
        </button>
      </div>
    );
  }

  // State: connected
  if (oauthStatus?.connected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Anthropic Account Connected</p>
          </div>
        </div>

        {/* Scopes */}
        {oauthStatus.scopes && oauthStatus.scopes.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Scopes
            </h3>
            <div className="flex flex-wrap gap-2">
              {oauthStatus.scopes.map((scope) => (
                <span
                  key={scope}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-secondary/40 border border-primary/15 text-muted-foreground/60"
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
            <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
              Expires
            </h3>
            <p className="text-sm text-foreground/70">
              {new Date(oauthStatus.expiresAt).toLocaleString()}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onRefreshOAuth}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-secondary/40 border border-primary/15 text-foreground/70 hover:text-foreground/90 hover:border-primary/25 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Token
          </button>
          <button
            onClick={onDisconnectOAuth}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
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
    <div className="space-y-5 max-w-md">
      <div className="flex flex-col items-center text-center py-8">
        <Shield className="w-10 h-10 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground/60 leading-relaxed">
          Connect your Anthropic account to enable OAuth-based authentication
          for cloud executions.
        </p>
      </div>

      <button
        onClick={onStartOAuth}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 text-foreground hover:bg-indigo-600 transition-colors cursor-pointer"
      >
        <ExternalLink className="w-4 h-4" />
        Connect Anthropic Account
      </button>
    </div>
  );
}

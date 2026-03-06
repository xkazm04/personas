import { useState } from 'react';
import { Loader2, LogIn, LogOut, ExternalLink } from 'lucide-react';
import { DEPLOYMENT_TOKENS } from '@/features/deployment/components/deploymentTokens';

interface GitLabConnectionFormProps {
  isConnected: boolean;
  username: string;
  token: string;
  setToken: (token: string) => void;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function GitLabConnectionForm({
  isConnected,
  username,
  token,
  setToken,
  isConnecting,
  onConnect,
  onDisconnect,
}: GitLabConnectionFormProps) {
  const [showToken, setShowToken] = useState(false);

  if (isConnected) {
    return (
      <div className={DEPLOYMENT_TOKENS.panelSpacing}>
        <div className={`p-4 ${DEPLOYMENT_TOKENS.cardRadius} ${DEPLOYMENT_TOKENS.connectedBg} border ${DEPLOYMENT_TOKENS.connectedBorder}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <span className="text-lg font-bold text-emerald-400">
                {username.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/90">Connected as @{username}</p>
              <p className="text-sm text-muted-foreground/70">gitlab.com</p>
            </div>
          </div>
        </div>

        <button
          onClick={onDisconnect}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      <div className={`p-4 ${DEPLOYMENT_TOKENS.cardRadius} bg-secondary/30 border border-primary/10`}>
        <h3 className={`text-sm font-medium text-foreground/90 ${DEPLOYMENT_TOKENS.sectionHeadingGap}`}>Personal Access Token</h3>
        <p className="text-sm text-muted-foreground/70 mb-3">
          Create a token at{' '}
          <a
            href="https://gitlab.com/-/user_settings/personal_access_tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
          >
            GitLab Settings <ExternalLink className="w-3 h-3" />
          </a>
          {' '}with <code className="text-sm px-1 py-0.5 bg-secondary/50 rounded">api</code> scope.
        </p>

        <div className="relative">
          <label htmlFor="gitlab-token" className="sr-only">GitLab personal access token</label>
          <input
            id="gitlab-token"
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
            className={`w-full px-3 py-2 pr-16 rounded-xl border border-primary/15 bg-background text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-500/40 ${isConnecting ? 'border-orange-500/35 bg-orange-500/5' : ''}`}
            onKeyDown={(e) => e.key === 'Enter' && onConnect()}
          />
          <button
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-sm text-muted-foreground/60 hover:text-foreground/80"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <button
        onClick={onConnect}
        disabled={isConnecting || !token.trim()}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-500/15 border border-orange-500/25 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isConnecting ? (
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
            <span className="sr-only">Connecting to GitLab...</span>
          </span>
        ) : (
          <LogIn className="w-4 h-4" />
        )}
        {isConnecting ? 'Connecting...' : 'Connect to GitLab'}
      </button>
    </div>
  );
}

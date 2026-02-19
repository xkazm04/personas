import { useState, useEffect } from 'react';
import {
  Cloud,
  Wifi,
  WifiOff,
  RefreshCw,
  Loader2,
  ExternalLink,
  Shield,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useCloudStore } from '@/stores/cloudStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'connection' | 'status' | 'oauth';

interface TabDef {
  id: TabId;
  label: string;
  disabledWhenOffline: boolean;
}

const TABS: TabDef[] = [
  { id: 'connection', label: 'Connection', disabledWhenOffline: false },
  { id: 'status', label: 'Status', disabledWhenOffline: true },
  { id: 'oauth', label: 'OAuth', disabledWhenOffline: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CloudDeployPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('connection');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [oauthCode, setOauthCode] = useState('');

  const config = useCloudStore((s) => s.config);
  const isConnecting = useCloudStore((s) => s.isConnecting);
  const status = useCloudStore((s) => s.status);
  const isLoadingStatus = useCloudStore((s) => s.isLoadingStatus);
  const oauthStatus = useCloudStore((s) => s.oauthStatus);
  const pendingOAuthState = useCloudStore((s) => s.pendingOAuthState);
  const error = useCloudStore((s) => s.error);

  const initialize = useCloudStore((s) => s.initialize);
  const connect = useCloudStore((s) => s.connect);
  const disconnect = useCloudStore((s) => s.disconnect);
  const fetchStatus = useCloudStore((s) => s.fetchStatus);
  const fetchOAuthStatus = useCloudStore((s) => s.fetchOAuthStatus);
  const startOAuth = useCloudStore((s) => s.startOAuth);
  const completeOAuth = useCloudStore((s) => s.completeOAuth);
  const refreshOAuth = useCloudStore((s) => s.refreshOAuth);
  const disconnectOAuth = useCloudStore((s) => s.disconnectOAuth);

  const isConnected = config?.is_connected ?? false;

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Auto-refresh when Status or OAuth tabs become active
  useEffect(() => {
    if (!isConnected) return;
    if (activeTab === 'status') {
      fetchStatus();
    } else if (activeTab === 'oauth') {
      fetchOAuthStatus();
    }
  }, [activeTab, isConnected, fetchStatus, fetchOAuthStatus]);

  // ---------- handlers ----------

  const handleConnect = async () => {
    if (!url.trim() || !apiKey.trim()) return;
    try {
      await connect(url.trim(), apiKey.trim());
    } catch {
      // error is surfaced via store
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setActiveTab('connection');
  };

  const handleStartOAuth = async () => {
    const result = await startOAuth();
    if (result?.authUrl) {
      window.open(result.authUrl, '_blank');
    }
  };

  const handleCompleteOAuth = async () => {
    if (!oauthCode.trim() || !pendingOAuthState) return;
    await completeOAuth(oauthCode.trim(), pendingOAuthState);
    setOauthCode('');
  };

  // ---------- render helpers ----------

  const connectionBadge = isConnected ? (
    <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
      <Wifi className="w-3 h-3" />
      Connected
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border bg-red-500/10 border-red-500/20 text-red-400">
      <WifiOff className="w-3 h-3" />
      Disconnected
    </span>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center gap-3">
          <Cloud className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-foreground/90">Cloud Execution</h2>
          <div className="ml-auto">{connectionBadge}</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-primary/10 bg-secondary/10">
        {TABS.map((tab) => {
          const disabled = tab.disabledWhenOffline && !isConnected;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              disabled={disabled}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-5 py-2.5 text-sm font-medium transition-colors relative
                ${active
                  ? 'text-foreground/90 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500'
                  : 'text-muted-foreground/50 hover:text-foreground/70'}
                ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'connection' && <ConnectionTab
          isConnected={isConnected}
          config={config}
          url={url}
          setUrl={setUrl}
          apiKey={apiKey}
          setApiKey={setApiKey}
          isConnecting={isConnecting}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />}
        {activeTab === 'status' && isConnected && <StatusTab
          status={status}
          isLoading={isLoadingStatus}
          onRefresh={fetchStatus}
        />}
        {activeTab === 'oauth' && isConnected && <OAuthTab
          oauthStatus={oauthStatus}
          pendingOAuthState={pendingOAuthState}
          oauthCode={oauthCode}
          setOauthCode={setOauthCode}
          onStartOAuth={handleStartOAuth}
          onCompleteOAuth={handleCompleteOAuth}
          onRefreshOAuth={refreshOAuth}
          onDisconnectOAuth={disconnectOAuth}
        />}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-6 py-3 border-t border-red-500/20 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Tab
// ---------------------------------------------------------------------------

interface ConnectionTabProps {
  isConnected: boolean;
  config: { url: string; is_connected: boolean } | null;
  url: string;
  setUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function ConnectionTab({
  isConnected,
  config,
  url,
  setUrl,
  apiKey,
  setApiKey,
  isConnecting,
  onConnect,
  onDisconnect,
}: ConnectionTabProps) {
  if (isConnected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <Wifi className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Connected</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              Orchestrator: {config?.url}
            </p>
          </div>
        </div>

        <button
          onClick={onDisconnect}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-md">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground/60">Orchestrator URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-orchestrator.example.com"
          className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-indigo-500/40 transition-colors"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground/60">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter API key"
          className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-indigo-500/40 transition-colors"
        />
      </div>

      <button
        onClick={onConnect}
        disabled={isConnecting || !url.trim() || !apiKey.trim()}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-500 text-foreground hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Connecting...
          </>
        ) : (
          'Connect'
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Tab
// ---------------------------------------------------------------------------

interface StatusTabProps {
  status: {
    workerCounts: { idle: number; executing: number; disconnected: number };
    queueLength: number;
    activeExecutions: number;
    hasClaudeToken: boolean;
  } | null;
  isLoading: boolean;
  onRefresh: () => void;
}

function StatusTab({ status, isLoading, onRefresh }: StatusTabProps) {
  if (!status && isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground/50">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!status) {
    return (
      <p className="text-sm text-muted-foreground/50 py-8 text-center">
        No status data available.
      </p>
    );
  }

  const workers = status.workerCounts;

  return (
    <div className="space-y-6">
      {/* Refresh button */}
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary/40 border border-primary/15 text-muted-foreground/60 hover:text-foreground/80 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Worker counts */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-3">
          Workers
        </h3>
        <div className="flex flex-wrap gap-3">
          <WorkerBadge label="Idle" count={workers.idle} color="emerald" />
          <WorkerBadge label="Executing" count={workers.executing} color="blue" />
          <WorkerBadge label="Disconnected" count={workers.disconnected} color="red" />
        </div>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-3">
          Activity
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Queue Length" value={status.queueLength} />
          <StatCard label="Active Executions" value={status.activeExecutions} />
        </div>
      </div>

      {/* Claude token indicator */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-3">
          Claude Token
        </h3>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30 border border-primary/10">
          {status.hasClaudeToken ? (
            <>
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-foreground/80">Token available</span>
            </>
          ) : (
            <>
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="text-sm text-foreground/80">No token configured</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Tab helpers
// ---------------------------------------------------------------------------

function WorkerBadge({ label, count, color }: { label: string; count: number; color: 'emerald' | 'blue' | 'red' }) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colorMap[color]}`}>
      <span className="text-lg font-semibold">{count}</span>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg bg-secondary/30 border border-primary/10">
      <p className="text-xs text-muted-foreground/50">{label}</p>
      <p className="text-xl font-semibold text-foreground/80 mt-1">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuth Tab
// ---------------------------------------------------------------------------

interface OAuthTabProps {
  oauthStatus: { connected: boolean; scopes: string[] | null; expiresAt: string | null; isExpired: boolean | null } | null;
  pendingOAuthState: string | null;
  oauthCode: string;
  setOauthCode: (v: string) => void;
  onStartOAuth: () => void;
  onCompleteOAuth: () => void;
  onRefreshOAuth: () => void;
  onDisconnectOAuth: () => void;
}

function OAuthTab({
  oauthStatus,
  pendingOAuthState,
  oauthCode,
  setOauthCode,
  onStartOAuth,
  onCompleteOAuth,
  onRefreshOAuth,
  onDisconnectOAuth,
}: OAuthTabProps) {
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

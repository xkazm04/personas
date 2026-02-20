import { useState, useEffect } from 'react';
import { Cloud, Wifi, WifiOff } from 'lucide-react';
import { useCloudStore } from '@/stores/cloudStore';
import { CloudConnectionForm } from '@/features/deployment/components/CloudConnectionForm';
import { CloudStatusPanel } from '@/features/deployment/components/CloudStatusPanel';
import { CloudOAuthPanel } from '@/features/deployment/components/CloudOAuthPanel';

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
        {activeTab === 'connection' && <CloudConnectionForm
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
        {activeTab === 'status' && isConnected && <CloudStatusPanel
          status={status}
          isLoading={isLoadingStatus}
          onRefresh={fetchStatus}
        />}
        {activeTab === 'oauth' && isConnected && <CloudOAuthPanel
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

import { useState, useEffect } from 'react';
import { Cloud, Wifi, WifiOff } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
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

  const config = usePersonaStore((s) => s.cloudConfig);
  const isConnecting = usePersonaStore((s) => s.cloudIsConnecting);
  const status = usePersonaStore((s) => s.cloudStatus);
  const isLoadingStatus = usePersonaStore((s) => s.cloudIsLoadingStatus);
  const oauthStatus = usePersonaStore((s) => s.cloudOAuthStatus);
  const pendingOAuthState = usePersonaStore((s) => s.cloudPendingOAuthState);
  const error = usePersonaStore((s) => s.cloudError);

  const initialize = usePersonaStore((s) => s.cloudInitialize);
  const connect = usePersonaStore((s) => s.cloudConnectAction);
  const disconnect = usePersonaStore((s) => s.cloudDisconnectAction);
  const fetchStatus = usePersonaStore((s) => s.cloudFetchStatus);
  const fetchOAuthStatus = usePersonaStore((s) => s.cloudFetchOAuthStatus);
  const startOAuth = usePersonaStore((s) => s.cloudStartOAuth);
  const completeOAuth = usePersonaStore((s) => s.cloudCompleteOAuth);
  const refreshOAuth = usePersonaStore((s) => s.cloudRefreshOAuth);
  const disconnectOAuth = usePersonaStore((s) => s.cloudDisconnectOAuth);

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
    <ContentBox>
      <ContentHeader
        icon={<Cloud className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Cloud Execution"
        actions={connectionBadge}
      >
        {/* Tab bar */}
        <div className="flex gap-0 mt-4 -mb-5 -mx-4 md:-mx-6 border-t border-primary/10">
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
      </ContentHeader>

      {/* Tab content */}
      <ContentBody>
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
      </ContentBody>

      {/* Error banner */}
      {error && (
        <div className="px-6 py-3 border-t border-red-500/20 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}
    </ContentBox>
  );
}

import { useState, useEffect } from 'react';
import { Cloud } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { ConnectionStatusBadge } from '@/features/shared/components/ConnectionStatusBadge';
import { PanelTabBar } from '@/features/shared/components/PanelTabBar';
import { ErrorBanner } from '@/features/shared/components/ErrorBanner';
import { CloudConnectionForm } from '@/features/deployment/components/CloudConnectionForm';
import { CloudStatusPanel } from '@/features/deployment/components/CloudStatusPanel';
import { CloudOAuthPanel } from '@/features/deployment/components/CloudOAuthPanel';
import { CloudDeploymentsPanel } from '@/features/deployment/components/CloudDeploymentsPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'connection' | 'status' | 'oauth' | 'deployments';

interface TabDef {
  id: TabId;
  label: string;
  disabledWhenOffline: boolean;
}

const TABS: TabDef[] = [
  { id: 'connection', label: 'Connection', disabledWhenOffline: false },
  { id: 'status', label: 'Status', disabledWhenOffline: true },
  { id: 'oauth', label: 'OAuth', disabledWhenOffline: true },
  { id: 'deployments', label: 'Deployments', disabledWhenOffline: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CloudDeployPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('connection');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [oauthStartUrl, setOauthStartUrl] = useState<string | null>(null);

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
  const cancelPendingOAuth = usePersonaStore((s) => s.cloudCancelPendingOAuth);
  const completeOAuth = usePersonaStore((s) => s.cloudCompleteOAuth);
  const refreshOAuth = usePersonaStore((s) => s.cloudRefreshOAuth);
  const disconnectOAuth = usePersonaStore((s) => s.cloudDisconnectOAuth);
  const clearError = usePersonaStore((s) => s.cloudClearError);
  const deployments = usePersonaStore((s) => s.cloudDeployments);
  const isDeploying = usePersonaStore((s) => s.cloudIsDeploying);
  const baseUrl = usePersonaStore((s) => s.cloudBaseUrl);
  const fetchDeployments = usePersonaStore((s) => s.cloudFetchDeployments);
  const deploy = usePersonaStore((s) => s.cloudDeploy);
  const pauseDeploy = usePersonaStore((s) => s.cloudPauseDeploy);
  const resumeDeploy = usePersonaStore((s) => s.cloudResumeDeploy);
  const removeDeploy = usePersonaStore((s) => s.cloudRemoveDeploy);

  const isConnected = config?.is_connected ?? false;

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Auto-refresh when Status, OAuth, or Deployments tabs become active
  useEffect(() => {
    if (!isConnected) return;
    if (activeTab === 'status') {
      fetchStatus();
    } else if (activeTab === 'oauth') {
      fetchOAuthStatus();
    } else if (activeTab === 'deployments') {
      fetchDeployments();
    }
  }, [activeTab, isConnected, fetchStatus, fetchOAuthStatus, fetchDeployments]);

  // ---------- handlers ----------

  const handleConnect = async () => {
    if (!url.trim() || !apiKey.trim()) return;
    try {
      await connect(url.trim(), apiKey.trim());
    } catch {
      // intentional: error state handled locally via store + ErrorBanner
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setUrl('');
    setApiKey('');
    setOauthStartUrl(null);
    setActiveTab('connection');
  };

  const handleCancelOAuth = async () => {
    await cancelPendingOAuth();
    setOauthStartUrl(null);
  };

  const handleDisconnectOAuth = async () => {
    await disconnectOAuth();
    setOauthStartUrl(null);
  };

  const handleStartOAuth = async () => {
    const result = await startOAuth();
    setOauthStartUrl(result?.authUrl ?? null);
  };

  const handleCompleteOAuth = async () => {
    if (!oauthCode.trim() || !pendingOAuthState) return;
    await completeOAuth(oauthCode.trim(), pendingOAuthState);
    setOauthCode('');
    setOauthStartUrl(null);
  };

  // ---------- render helpers ----------

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cloud className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Cloud Execution"
        actions={<ConnectionStatusBadge connected={isConnected} isBusy={isConnecting} />}
      >
        <PanelTabBar
          tabs={TABS.map((tab) => ({ ...tab, disabled: tab.disabledWhenOffline && !isConnected }))}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeUnderlineClass="after:bg-indigo-500"
          idPrefix="cloud-deploy"
        />
      </ContentHeader>

      {/* Tab content */}
      <ContentBody>
        <div
          role="tabpanel"
          id={`cloud-deploy-panel-${activeTab}`}
          aria-labelledby={`cloud-deploy-tab-${activeTab}`}
        >
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
            oauthStartUrl={oauthStartUrl}
            onStartOAuth={handleStartOAuth}
            onCompleteOAuth={handleCompleteOAuth}
            onCancelOAuth={handleCancelOAuth}
            onRefreshOAuth={refreshOAuth}
            onDisconnectOAuth={handleDisconnectOAuth}
          />}
          {activeTab === 'deployments' && isConnected && <CloudDeploymentsPanel
            deployments={deployments}
            baseUrl={baseUrl}
            isDeploying={isDeploying}
            onDeploy={deploy}
            onPause={pauseDeploy}
            onResume={resumeDeploy}
            onRemove={removeDeploy}
            onRefresh={fetchDeployments}
          />}
        </div>
      </ContentBody>

      {error && <ErrorBanner message={error} onDismiss={clearError} />}
    </ContentBox>
  );
}

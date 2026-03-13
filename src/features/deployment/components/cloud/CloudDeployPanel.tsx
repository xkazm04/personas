import { useState, useEffect } from 'react';
import { Cloud } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ConnectionStatusBadge } from '@/features/shared/components/feedback/ConnectionStatusBadge';
import { PanelTabBar } from '@/features/shared/components/layout/PanelTabBar';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { CloudConnectionForm } from '@/features/deployment/components/cloud/CloudConnectionForm';
import { CloudStatusPanel } from '@/features/deployment/components/cloud/CloudStatusPanel';
import { CloudOAuthPanel } from '@/features/deployment/components/cloud/CloudOAuthPanel';
import { CloudDeploymentsPanel } from '@/features/deployment/components/cloud/CloudDeploymentsPanel';
import { CloudHistoryPanel } from '@/features/deployment/components/cloud/CloudHistoryPanel';
import { CloudSchedulesPanel } from '@/features/deployment/components/cloud/CloudSchedulesPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'connection' | 'status' | 'oauth' | 'deployments' | 'schedules' | 'history';

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
  { id: 'schedules', label: 'Schedules', disabledWhenOffline: true },
  { id: 'history', label: 'History', disabledWhenOffline: true },
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

  const config = useSystemStore((s) => s.cloudConfig);
  const isConnecting = useSystemStore((s) => s.cloudIsConnecting);
  const status = useSystemStore((s) => s.cloudStatus);
  const isLoadingStatus = useSystemStore((s) => s.cloudIsLoadingStatus);
  const oauthStatus = useSystemStore((s) => s.cloudOAuthStatus);
  const pendingOAuthState = useSystemStore((s) => s.cloudPendingOAuthState);
  const error = useSystemStore((s) => s.cloudError);

  const initialize = useSystemStore((s) => s.cloudInitialize);
  const connect = useSystemStore((s) => s.cloudConnectAction);
  const disconnect = useSystemStore((s) => s.cloudDisconnectAction);
  const fetchStatus = useSystemStore((s) => s.cloudFetchStatus);
  const fetchOAuthStatus = useSystemStore((s) => s.cloudFetchOAuthStatus);
  const startOAuth = useSystemStore((s) => s.cloudStartOAuth);
  const cancelPendingOAuth = useSystemStore((s) => s.cloudCancelPendingOAuth);
  const completeOAuth = useSystemStore((s) => s.cloudCompleteOAuth);
  const refreshOAuth = useSystemStore((s) => s.cloudRefreshOAuth);
  const disconnectOAuth = useSystemStore((s) => s.cloudDisconnectOAuth);
  const clearError = useSystemStore((s) => s.cloudClearError);
  const deployments = useSystemStore((s) => s.cloudDeployments);
  const isDeploying = useSystemStore((s) => s.cloudIsDeploying);
  const baseUrl = useSystemStore((s) => s.cloudBaseUrl);
  const fetchDeployments = useSystemStore((s) => s.cloudFetchDeployments);
  const deploy = useSystemStore((s) => s.cloudDeploy);
  const pauseDeploy = useSystemStore((s) => s.cloudPauseDeploy);
  const resumeDeploy = useSystemStore((s) => s.cloudResumeDeploy);
  const removeDeploy = useSystemStore((s) => s.cloudRemoveDeploy);

  const isConnected = config?.is_connected ?? false;

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Auto-refresh when Status, OAuth, Deployments, or Schedules tabs become active
  useEffect(() => {
    if (!isConnected) return;
    if (activeTab === 'status') {
      fetchStatus();
    } else if (activeTab === 'oauth') {
      fetchOAuthStatus();
    } else if (activeTab === 'deployments' || activeTab === 'schedules') {
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
          underlineClass="bg-indigo-500"
          idPrefix="cloud-deploy"
          layoutIdPrefix="cloud-tab"
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
          {activeTab === 'schedules' && isConnected && <CloudSchedulesPanel
            deployments={deployments}
            onRefresh={fetchDeployments}
          />}
          {activeTab === 'history' && isConnected && <CloudHistoryPanel />}
        </div>
      </ContentBody>

      {error && <ErrorBanner message={error} onDismiss={clearError} />}
    </ContentBox>
  );
}

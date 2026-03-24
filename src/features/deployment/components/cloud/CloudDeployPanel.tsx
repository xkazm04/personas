import { useState, useEffect, useCallback } from 'react';
import { Cloud, Activity } from 'lucide-react';
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
import { cloudDiagnose, type CloudDiagnostics } from '@/api/system/cloud';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { useCloudHealthMonitor } from '@/features/deployment/hooks/useCloudHealthMonitor';

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
  const [diagnostics, setDiagnostics] = useState<CloudDiagnostics | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

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

  const latencyMs = useSystemStore((s) => s.cloudConnectionLatencyMs);
  const reconnectState = useSystemStore((s) => s.cloudReconnectState);

  const isConnected = config?.is_connected ?? false;

  // Health monitoring — auto-reconnect when connection drops
  useCloudHealthMonitor();

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Auto-refresh when Status, OAuth, Deployments, or Schedules tabs become active
  useEffect(() => {
    if (!isConnected) return;
    if (activeTab === 'oauth') {
      fetchOAuthStatus();
    } else if (activeTab === 'deployments' || activeTab === 'schedules') {
      fetchDeployments();
    }
    // Status tab is now handled by usePolling below
  }, [activeTab, isConnected, fetchOAuthStatus, fetchDeployments]);

  // Auto-poll cloud status while the Status tab is active and connected
  const { lastRefreshed: statusLastRefreshed } = usePolling(fetchStatus, {
    ...POLLING_CONFIG.cloudStatus,
    enabled: isConnected && activeTab === 'status',
  });

  // ---------- handlers ----------

  const handleConnect = async () => {
    if (!url.trim() || !apiKey.trim()) return;
    setDiagnostics(null);
    try {
      await connect(url.trim(), apiKey.trim());
    } catch {
      // intentional: error state handled locally via store + ErrorBanner
    }
  };

  const handleDiagnose = useCallback(async () => {
    if (!url.trim() || !apiKey.trim()) return;
    setIsDiagnosing(true);
    setDiagnostics(null);
    try {
      const result = await cloudDiagnose(url.trim(), apiKey.trim());
      setDiagnostics(result);
    } catch {
      // Diagnostics command itself failed -- ignore
    } finally {
      setIsDiagnosing(false);
    }
  }, [url, apiKey]);

  const handleDisconnect = async () => {
    await disconnect();
    setUrl('');
    setApiKey('');
    setOauthStartUrl(null);
    setDiagnostics(null);
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
        actions={
          <div className="flex items-center gap-2">
            <ConnectionStatusBadge
              connected={isConnected}
              isBusy={isConnecting}
              reconnecting={reconnectState.isReconnecting ? reconnectState : null}
            />
            {isConnected && latencyMs != null && <LatencyBadge ms={latencyMs} />}
          </div>
        }
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
            diagnostics={diagnostics}
            isDiagnosing={isDiagnosing}
            onDiagnose={handleDiagnose}
          />}
          {activeTab === 'status' && isConnected && <CloudStatusPanel
            status={status}
            isLoading={isLoadingStatus}
            onRefresh={fetchStatus}
            lastPolled={statusLastRefreshed}
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

// ---------------------------------------------------------------------------
// Latency Badge
// ---------------------------------------------------------------------------

function LatencyBadge({ ms }: { ms: number }) {
  const { color, bg, border } =
    ms < 200
      ? { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' }
      : ms < 1000
        ? { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' }
        : { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };

  return (
    <span
      className={`flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-lg border ${bg} ${border} ${color}`}
      title={`Health-check round-trip latency: ${ms}ms`}
    >
      <Activity className="w-3 h-3" />
      {ms}ms
    </span>
  );
}

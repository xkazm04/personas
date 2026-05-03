import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, Monitor, Download, RefreshCw } from 'lucide-react';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  discoverDesktopApps,
  importClaudeMcpServers,
  getDesktopConnectorManifest,
  approveDesktopCapabilities,
  registerImportedMcpServer,
  type DiscoveredApp,
  type ImportedMcpServer,
  type DesktopConnectorManifest,
} from '@/api/system/desktop';
import { DiscoveryAppList } from './DiscoveryAppList';
import { DiscoveryMcpList } from './DiscoveryMcpList';
import { useTranslation } from '@/i18n/useTranslation';

interface DesktopDiscoveryPanelProps {
  onBack: () => void;
  onCredentialCreated?: () => void;
}

type Tab = 'apps' | 'mcp-import';

export function DesktopDiscoveryPanel({ onBack, onCredentialCreated }: DesktopDiscoveryPanelProps) {
  const { t, tx } = useTranslation();
  const dd = t.vault.desktop_discovery;
  const [tab, setTab] = useState<Tab>('apps');
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [mcpServers, setMcpServers] = useState<ImportedMcpServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importingMcp, setImportingMcp] = useState(false);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [manifest, setManifest] = useState<DesktopConnectorManifest | null>(null);
  const [approving, setApproving] = useState(false);
  const [importingServer, setImportingServer] = useState<string | null>(null);
  const [importedServers, setImportedServers] = useState<Set<string>>(new Set());

  // Scans run on mount; failure surfaces as the empty-state UI rather than
  // a toast, so the catches use silentCatch for the breadcrumb only.
  const scanApps = useCallback(async () => {
    setScanning(true);
    try {
      const discovered = await discoverDesktopApps();
      setApps(discovered);
    } catch (e) {
      silentCatch('DesktopDiscoveryPanel:scanApps')(e);
    } finally {
      setScanning(false);
    }
  }, []);

  const scanMcpServers = useCallback(async () => {
    setImportingMcp(true);
    try {
      const servers = await importClaudeMcpServers();
      setMcpServers(servers);
    } catch (e) {
      silentCatch('DesktopDiscoveryPanel:scanMcpServers')(e);
    } finally {
      setImportingMcp(false);
    }
  }, []);

  useEffect(() => {
    void scanApps();
    void scanMcpServers();
  }, [scanApps, scanMcpServers]);

  // Latest-selection-wins guard: if the user clicks app A then quickly clicks
  // app B before A's fetch resolves, A's response can land after B's and
  // clobber the manifest. Compare against the in-flight selection before
  // committing the result.
  const inflightSelectionRef = useRef<string | null>(null);
  const handleSelectApp = async (connectorName: string) => {
    setSelectedApp(connectorName);
    inflightSelectionRef.current = connectorName;
    try {
      const m = await getDesktopConnectorManifest(connectorName);
      if (inflightSelectionRef.current !== connectorName) return;
      setManifest(m);
    } catch (e) {
      toastCatch('DesktopDiscoveryPanel:getManifest')(e);
    }
  };

  const handleApprove = async () => {
    if (!manifest) return;
    setApproving(true);
    try {
      await approveDesktopCapabilities(manifest.connector_id, manifest.capabilities);
      setSelectedApp(null);
      setManifest(null);
      onCredentialCreated?.();
    } catch (e) {
      toastCatch('DesktopDiscoveryPanel:approveCapabilities')(e);
    } finally {
      setApproving(false);
    }
  };

  const handleImportMcpServer = async (server: ImportedMcpServer) => {
    setImportingServer(server.name);
    try {
      await registerImportedMcpServer(server, tx(dd.imported_suffix, { name: server.label }));
      setImportedServers((prev) => new Set([...prev, server.name]));
      onCredentialCreated?.();
    } catch (e) {
      toastCatch('DesktopDiscoveryPanel:importMcpServer')(e);
    } finally {
      setImportingServer(null);
    }
  };

  const installedApps = useMemo(() => apps.filter((a) => a.installed), [apps]);
  const notInstalledApps = useMemo(() => apps.filter((a) => !a.installed), [apps]);

  return (
    <div
      className="animate-fade-slide-in space-y-4"
      data-testid="vault-desktop-container"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          data-testid="vault-desktop-back"
          onClick={onBack}
          aria-label={t.common.back}
          title={t.common.back}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h3 className="typo-heading font-semibold text-foreground">{dd.title}</h3>
          <p className="typo-body text-foreground">
            {dd.connect_description}
          </p>
        </div>
        <button
          onClick={() => { void scanApps(); void scanMcpServers(); }}
          disabled={scanning}
          data-testid="vault-desktop-scan"
          aria-label={dd.rescan_aria}
          title={dd.rescan_aria}
          className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary/30 rounded-card">
        <button
          onClick={() => setTab('apps')}
          className={`flex-1 px-3 py-1.5 rounded-input typo-caption font-medium transition-colors ${
            tab === 'apps'
              ? 'bg-secondary/80 text-foreground'
              : 'text-foreground hover:text-foreground'
          }`}
        >
          <Monitor className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          {tx(dd.detected_apps_tab, { count: installedApps.length })}
        </button>
        <button
          onClick={() => setTab('mcp-import')}
          data-testid="vault-desktop-import-mcp"
          className={`flex-1 px-3 py-1.5 rounded-input typo-caption font-medium transition-colors ${
            tab === 'mcp-import'
              ? 'bg-secondary/80 text-foreground'
              : 'text-foreground hover:text-foreground'
          }`}
        >
          <Download className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          {tx(dd.claude_mcp_tab, { count: mcpServers.length })}
        </button>
      </div>

      {tab === 'apps' && (
        <DiscoveryAppList
          installedApps={installedApps}
          notInstalledApps={notInstalledApps}
          allApps={apps}
          scanning={scanning}
          selectedApp={selectedApp}
          manifest={manifest}
          approving={approving}
          onSelectApp={handleSelectApp}
          onApprove={handleApprove}
          onCancelApproval={() => { setSelectedApp(null); setManifest(null); }}
        />
      )}

      {tab === 'mcp-import' && (
        <DiscoveryMcpList
          mcpServers={mcpServers}
          importingMcp={importingMcp}
          importingServer={importingServer}
          importedServers={importedServers}
          onImport={handleImportMcpServer}
        />
      )}
    </div>
  );
}

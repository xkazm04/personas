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
import Button from '@/features/shared/components/buttons/Button';

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
  //
  // The previous manifest is dropped on every new selection: the approval card
  // renders `selectedApp`'s label over `manifest`'s capabilities, and Approve
  // sends `manifest.connector_id`, so a manifest left over from app A would
  // ask "approve B?" while granting A's capabilities to A.
  const inflightSelectionRef = useRef<string | null>(null);
  const handleSelectApp = async (connectorName: string) => {
    setSelectedApp(connectorName);
    setManifest(null);
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
        <Button
          type="button"
          data-testid="vault-desktop-back"
          onClick={onBack}
          aria-label={t.common.back}
          tooltip={t.common.back}
          variant="ghost"
          size="icon-sm"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h3 className="typo-heading text-foreground">{dd.title}</h3>
          <p className="typo-body text-foreground">
            {dd.connect_description}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => { void scanApps(); void scanMcpServers(); }}
          disabled={scanning}
          data-testid="vault-desktop-scan"
          aria-label={dd.rescan_aria}
          tooltip={dd.rescan_aria}
          variant="ghost"
          size="icon-sm"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-1 rounded-card">
        <Button
          type="button"
          onClick={() => setTab('apps')}
          variant="ghost"
          size="sm"
          className="flex-1"
          icon={<Monitor className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />}
        >
          {tx(dd.detected_apps_tab, { count: installedApps.length })}
        </Button>
        <Button
          type="button"
          onClick={() => setTab('mcp-import')}
          data-testid="vault-desktop-import-mcp"
          variant="ghost"
          size="sm"
          className="flex-1"
          icon={<Download className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />}
        >
          {tx(dd.claude_mcp_tab, { count: mcpServers.length })}
        </Button>
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
          onCancelApproval={() => { inflightSelectionRef.current = null; setSelectedApp(null); setManifest(null); }}
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

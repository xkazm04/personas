import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Monitor, Download, RefreshCw } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('vault-discovery');
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
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
import { DesktopAppCard } from './DesktopAppCard';
import { CapabilityApprovalCard } from './CapabilityApprovalCard';
import { McpServerCard } from './McpServerCard';

interface DesktopDiscoveryPanelProps {
  onBack: () => void;
  onCredentialCreated?: () => void;
}

type Tab = 'apps' | 'mcp-import';

export function DesktopDiscoveryPanel({ onBack, onCredentialCreated }: DesktopDiscoveryPanelProps) {
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

  const scanApps = useCallback(async () => {
    setScanning(true);
    try {
      const discovered = await discoverDesktopApps();
      setApps(discovered);
    } catch (e) {
      logger.error('Failed to discover desktop apps', { error: String(e) });
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
      logger.error('Failed to import Claude MCP servers', { error: String(e) });
    } finally {
      setImportingMcp(false);
    }
  }, []);

  useEffect(() => {
    void scanApps();
    void scanMcpServers();
  }, [scanApps, scanMcpServers]);

  const handleSelectApp = async (connectorName: string) => {
    setSelectedApp(connectorName);
    try {
      const m = await getDesktopConnectorManifest(connectorName);
      setManifest(m);
    } catch (e) {
      logger.error('Failed to get manifest', { error: String(e) });
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
      logger.error('Failed to approve capabilities', { error: String(e) });
    } finally {
      setApproving(false);
    }
  };

  const handleImportMcpServer = async (server: ImportedMcpServer) => {
    setImportingServer(server.name);
    try {
      await registerImportedMcpServer(server, `${server.label} (Claude Desktop)`);
      setImportedServers((prev) => new Set([...prev, server.name]));
      onCredentialCreated?.();
    } catch (e) {
      logger.error('Failed to import MCP server', { error: String(e) });
    } finally {
      setImportingServer(null);
    }
  };

  const installedApps = apps.filter((a) => a.installed);
  const notInstalledApps = apps.filter((a) => !a.installed);

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
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Desktop Apps</h3>
          <p className="text-sm text-muted-foreground/60">
            Connect local applications or import Claude Desktop MCP servers
          </p>
        </div>
        <button
          onClick={() => { void scanApps(); void scanMcpServers(); }}
          disabled={scanning}
          data-testid="vault-desktop-scan"
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary/30 rounded-lg">
        <button
          onClick={() => setTab('apps')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            tab === 'apps'
              ? 'bg-secondary/80 text-foreground'
              : 'text-muted-foreground/60 hover:text-foreground'
          }`}
        >
          <Monitor className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          Detected Apps ({installedApps.length})
        </button>
        <button
          onClick={() => setTab('mcp-import')}
          data-testid="vault-desktop-import-mcp"
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            tab === 'mcp-import'
              ? 'bg-secondary/80 text-foreground'
              : 'text-muted-foreground/60 hover:text-foreground'
          }`}
        >
          <Download className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          Claude MCP ({mcpServers.length})
        </button>
      </div>

      {tab === 'apps' && (
          <div
            key="apps"
            className="animate-fade-slide-in space-y-3"
          >
            {scanning ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground/60">
                <LoadingSpinner className="mr-2" />
                Scanning for desktop apps...
              </div>
            ) : (
              <>
                {installedApps.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                      Detected on your system
                    </h4>
                    {installedApps.map((app) => (
                      <DesktopAppCard
                        key={app.connector_name}
                        app={app}
                        selected={selectedApp === app.connector_name}
                        onSelect={() => handleSelectApp(app.connector_name)}
                      />
                    ))}
                  </div>
                )}

                {notInstalledApps.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide">
                      Not detected
                    </h4>
                    {notInstalledApps.map((app) => (
                      <DesktopAppCard
                        key={app.connector_name}
                        app={app}
                        selected={false}
                        onSelect={() => {}}
                        disabled
                      />
                    ))}
                  </div>
                )}

                {apps.length === 0 && !scanning && (
                  <div className="text-center py-8 text-muted-foreground/60 text-sm">
                    No desktop apps detected. Try refreshing.
                  </div>
                )}
              </>
            )}

            {selectedApp && manifest && (
                <CapabilityApprovalCard
                  manifest={manifest}
                  app={apps.find((a) => a.connector_name === selectedApp)!}
                  onApprove={handleApprove}
                  onCancel={() => { setSelectedApp(null); setManifest(null); }}
                  approving={approving}
                />
              )}
          </div>
        )}

        {tab === 'mcp-import' && (
          <div
            key="mcp"
            className="animate-fade-slide-in space-y-2"
          >
            {importingMcp ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground/60">
                <LoadingSpinner className="mr-2" />
                Reading Claude Desktop config...
              </div>
            ) : mcpServers.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground/60 mb-3">
                  Found {mcpServers.length} MCP server{mcpServers.length !== 1 ? 's' : ''} in Claude Desktop configuration.
                  Import them as credentials to use with your agents.
                </p>
                {mcpServers.map((server) => (
                  <McpServerCard
                    key={server.name}
                    server={server}
                    imported={importedServers.has(server.name)}
                    importing={importingServer === server.name}
                    onImport={() => handleImportMcpServer(server)}
                  />
                ))}
              </>
            ) : (
              <div className="text-center py-8 space-y-2">
                <p className="text-sm text-muted-foreground/60">
                  No Claude Desktop MCP configuration found.
                </p>
                <p className="text-xs text-muted-foreground/60">
                  If you have Claude Desktop installed, ensure it has MCP servers configured in its settings.
                </p>
              </div>
            )}
          </div>
        )}
    </div>
  );
}

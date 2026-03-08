import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Monitor,
  CheckCircle2,
  Shield,
  Download,
  RefreshCw,
  ChevronRight,
  Loader2,
  CircleDot,
} from 'lucide-react';
import {
  discoverDesktopApps,
  importClaudeMcpServers,
  getDesktopConnectorManifest,
  approveDesktopCapabilities,
  registerImportedMcpServer,
  CAPABILITY_INFO,
  type DiscoveredApp,
  type ImportedMcpServer,
  type DesktopConnectorManifest,
} from '@/api/desktop';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';

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
      console.error('Failed to discover desktop apps:', e);
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
      console.error('Failed to import Claude MCP servers:', e);
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
      console.error('Failed to get manifest:', e);
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
      console.error('Failed to approve capabilities:', e);
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
      console.error('Failed to import MCP server:', e);
    } finally {
      setImportingServer(null);
    }
  };

  const installedApps = apps.filter((a) => a.installed);
  const notInstalledApps = apps.filter((a) => !a.installed);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
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

      <AnimatePresence mode="wait">
        {tab === 'apps' && (
          <motion.div
            key="apps"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {scanning ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground/60">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Scanning for desktop apps...
              </div>
            ) : (
              <>
                {/* Installed apps */}
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

                {/* Not installed */}
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

            {/* Approval modal */}
            <AnimatePresence>
              {selectedApp && manifest && (
                <CapabilityApprovalCard
                  manifest={manifest}
                  app={apps.find((a) => a.connector_name === selectedApp)!}
                  onApprove={handleApprove}
                  onCancel={() => { setSelectedApp(null); setManifest(null); }}
                  approving={approving}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {tab === 'mcp-import' && (
          <motion.div
            key="mcp"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            {importingMcp ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground/60">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function DesktopAppCard({
  app,
  selected,
  onSelect,
  disabled = false,
}: {
  app: DiscoveredApp;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const meta = getConnectorMeta(app.connector_name);

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-primary/5 bg-secondary/10'
          : selected
            ? 'border-orange-500/30 bg-orange-500/5'
            : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center border"
          style={{
            backgroundColor: `${meta.color}15`,
            borderColor: `${meta.color}30`,
          }}
        >
          <ConnectorIcon meta={meta} size="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{app.label}</span>
            {app.installed && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                Installed
              </span>
            )}
            {app.running && (
              <span className="flex items-center gap-1 text-xs text-cyan-400">
                <CircleDot className="w-3 h-3" />
                Running
              </span>
            )}
          </div>
          {app.binary_path && (
            <p className="text-xs text-muted-foreground/60 truncate">{app.binary_path}</p>
          )}
        </div>
        {!disabled && <ChevronRight className="w-4 h-4 text-muted-foreground/50" />}
      </div>
    </button>
  );
}

function CapabilityApprovalCard({
  manifest,
  app,
  onApprove,
  onCancel,
  approving,
}: {
  manifest: DesktopConnectorManifest;
  app: DiscoveredApp;
  onApprove: () => void;
  onCancel: () => void;
  approving: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="p-4 rounded-xl border border-orange-500/20 bg-gradient-to-b from-orange-500/5 to-transparent space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-orange-400" />
          <h4 className="text-sm font-semibold text-foreground">
            Permission Required
          </h4>
        </div>

        <p className="text-xs text-muted-foreground/70">
          <strong>{app.label}</strong> requests the following capabilities.
          Review and approve to enable this connector.
        </p>

        <div className="space-y-1.5">
          {manifest.capabilities.map((cap) => {
            const info = CAPABILITY_INFO[cap];
            return (
              <div
                key={cap}
                className="flex items-center gap-3 p-2 rounded-lg bg-secondary/20"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    info.risk === 'high'
                      ? 'bg-rose-400'
                      : info.risk === 'medium'
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{info.label}</p>
                  <p className="text-xs text-muted-foreground/50">{info.description}</p>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    info.risk === 'high'
                      ? 'bg-rose-500/10 text-rose-400'
                      : info.risk === 'medium'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-emerald-500/10 text-emerald-400'
                  }`}
                >
                  {info.risk}
                </span>
              </div>
            );
          })}
        </div>

        {manifest.allowed_binaries.length > 0 && (
          <div className="text-xs text-muted-foreground/60">
            <span className="font-medium">Allowed binaries: </span>
            {manifest.allowed_binaries.join(', ')}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-muted-foreground/80 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            disabled={approving}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {approving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
            ) : (
              'Approve & Connect'
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function McpServerCard({
  server,
  imported,
  importing,
  onImport,
}: {
  server: ImportedMcpServer;
  imported: boolean;
  importing: boolean;
  onImport: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/10 bg-secondary/20">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center border bg-cyan-500/10 border-cyan-500/20">
        <Monitor className="w-4 h-4 text-cyan-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{server.label}</p>
        <p className="text-xs text-muted-foreground/60 truncate font-mono">{server.command}</p>
        {Object.keys(server.env).length > 0 && (
          <p className="text-xs text-muted-foreground/60">
            {Object.keys(server.env).length} env var{Object.keys(server.env).length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
      {imported ? (
        <span className="flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Imported
        </span>
      ) : (
        <button
          onClick={onImport}
          disabled={importing}
          className="px-3 py-1.5 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
        >
          {importing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            'Import'
          )}
        </button>
      )}
    </div>
  );
}

import type { ImportedMcpServer } from '@/api/system/desktop';
import { McpServerCard } from './McpServerCard';
import { useTranslation } from '@/i18n/useTranslation';

const GHOST_WIDTHS = ['w-36', 'w-28', 'w-44'];

function McpListGhost() {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-modal border border-primary/10 bg-secondary/20 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <span className="w-8 h-8 rounded-card bg-primary/[0.06] shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <span className={`block h-3.5 rounded bg-primary/[0.06] ${GHOST_WIDTHS[i % GHOST_WIDTHS.length]}`} />
            <span className="block h-2.5 w-40 rounded bg-primary/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface DiscoveryMcpListProps {
  mcpServers: ImportedMcpServer[];
  importingMcp: boolean;
  importingServer: string | null;
  importedServers: Set<string>;
  onImport: (server: ImportedMcpServer) => void;
}

export function DiscoveryMcpList({
  mcpServers,
  importingMcp,
  importingServer,
  importedServers,
  onImport,
}: DiscoveryMcpListProps) {
  const { t, tx } = useTranslation();
  const dd = t.vault.desktop_discovery;
  return (
    <div
      key="mcp"
      className="animate-fade-slide-in space-y-2"
    >
      {importingMcp && mcpServers.length === 0 ? (
        <McpListGhost />
      ) : mcpServers.length > 0 ? (
        <>
          <p className="typo-caption text-foreground mb-3">
            {tx(mcpServers.length === 1 ? dd.mcp_servers_found_one : dd.mcp_servers_found_other, { count: mcpServers.length })}
          </p>
          {mcpServers.map((server) => (
            <McpServerCard
              key={server.name}
              server={server}
              imported={importedServers.has(server.name)}
              importing={importingServer === server.name}
              onImport={() => onImport(server)}
            />
          ))}
        </>
      ) : (
        <div className="text-center py-8 space-y-2">
          <p className="typo-body text-foreground">
            {dd.no_mcp_config}
          </p>
          <p className="typo-caption text-foreground">
            {dd.mcp_config_hint}
          </p>
        </div>
      )}
    </div>
  );
}

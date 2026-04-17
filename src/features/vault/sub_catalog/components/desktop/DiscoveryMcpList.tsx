import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ImportedMcpServer } from '@/api/system/desktop';
import { McpServerCard } from './McpServerCard';
import { useTranslation } from '@/i18n/useTranslation';

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
      {importingMcp ? (
        <div className="flex items-center justify-center py-8 text-foreground">
          <LoadingSpinner className="mr-2" />
          {dd.reading_config}
        </div>
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

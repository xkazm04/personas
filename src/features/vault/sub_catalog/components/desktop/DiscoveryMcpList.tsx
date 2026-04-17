import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ImportedMcpServer } from '@/api/system/desktop';
import { McpServerCard } from './McpServerCard';

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
  return (
    <div
      key="mcp"
      className="animate-fade-slide-in space-y-2"
    >
      {importingMcp ? (
        <div className="flex items-center justify-center py-8 text-foreground">
          <LoadingSpinner className="mr-2" />
          Reading Claude Desktop config...
        </div>
      ) : mcpServers.length > 0 ? (
        <>
          <p className="typo-caption text-foreground mb-3">
            Found {mcpServers.length} MCP server{mcpServers.length !== 1 ? 's' : ''} in Claude Desktop configuration.
            Import them as credentials to use with your agents.
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
            No Claude Desktop MCP configuration found.
          </p>
          <p className="typo-caption text-foreground">
            If you have Claude Desktop installed, ensure it has MCP servers configured in its settings.
          </p>
        </div>
      )}
    </div>
  );
}

import { Table2, Code2 } from 'lucide-react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DatabaseCardProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  tableCount: number;
  queryCount: number;
  onClick: () => void;
}

export function DatabaseCard({ credential, connector, tableCount, queryCount, onClick }: DatabaseCardProps) {
  const iconUrl = connector?.icon_url;
  const color = connector?.color || '#6B7280';

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20 transition-all group"
    >
      <div className="flex items-center gap-3">
        {/* Connector icon */}
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center border border-primary/15 shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          {iconUrl ? (
            <img src={iconUrl} alt="" className="w-5 h-5 object-contain" />
          ) : (
            <div className="w-5 h-5 rounded" style={{ backgroundColor: color }} />
          )}
        </div>

        {/* Name + service type */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground/90 truncate group-hover:text-foreground transition-colors">
            {credential.name}
          </h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            {connector?.label || credential.service_type}
          </p>
        </div>

        {/* Stats badges */}
        <div className="flex items-center gap-2 shrink-0">
          {tableCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400/80 text-sm">
              <Table2 className="w-3 h-3" />
              {tableCount}
            </span>
          )}
          {queryCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400/80 text-sm">
              <Code2 className="w-3 h-3" />
              {queryCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

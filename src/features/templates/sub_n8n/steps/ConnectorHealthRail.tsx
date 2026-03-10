import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { translateHealthcheckMessage } from '@/features/vault/sub_design/CredentialDesignHelpers';
import type { ConnectorRailItem } from '../edit/connectorHealth';

interface ConnectorHealthRailProps {
  connectorRailItems: ConnectorRailItem[];
  readyConnectorCount: number;
}

export function ConnectorHealthRail({ connectorRailItems, readyConnectorCount }: ConnectorHealthRailProps) {
  if (connectorRailItems.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/15 overflow-hidden mb-2" data-testid="connector-health-rail">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3.5 py-2.5 bg-secondary/25 border-b border-primary/[0.06]" data-testid="connector-health-summary">
        <span className="text-sm text-muted-foreground/80">
          <span className={`font-semibold ${readyConnectorCount === connectorRailItems.length ? 'text-emerald-400' : readyConnectorCount > 0 ? 'text-amber-400' : 'text-red-400'}`}>
            {readyConnectorCount}
          </span>
          {' '}of {connectorRailItems.length} connector{connectorRailItems.length !== 1 ? 's' : ''} ready
        </span>
        <div className="flex-1 h-1 rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: connectorRailItems.length > 0 ? `${(readyConnectorCount / connectorRailItems.length) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Connector rows */}
      <div className="divide-y divide-primary/[0.06]">
        {connectorRailItems.map((item) => {
          const dotColor = item.health === 'ready'
            ? 'bg-emerald-400'
            : item.health === 'failed'
              ? 'bg-red-400'
              : 'bg-amber-400';
          const statusIcon = item.health === 'ready'
            ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            : item.health === 'failed'
              ? <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
              : <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />;
          const translated = item.errorMessage
            ? translateHealthcheckMessage(item.errorMessage)
            : null;

          return (
            <div
              key={item.name}
              className="flex items-center gap-3 px-3.5 h-10"
              data-testid={`connector-rail-row-${item.name}`}
            >
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />

              {/* Connector name */}
              <span className="text-sm font-medium text-foreground/80 truncate min-w-0 flex-1">
                {item.name}
              </span>

              {/* Credential name or missing label */}
              {item.credentialName ? (
                <span className="text-sm text-muted-foreground/60 truncate max-w-[140px]">
                  {item.credentialName}
                </span>
              ) : (
                <span className="text-sm text-amber-400/70">No credential</span>
              )}

              {/* Status icon */}
              {statusIcon}

              {/* Error message for failed connectors */}
              {translated && (
                <span className="text-sm text-red-400/70 truncate max-w-[180px]" title={translated.raw}>
                  {translated.friendly}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

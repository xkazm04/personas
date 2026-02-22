import { CheckCircle2, AlertCircle, XCircle, HelpCircle } from 'lucide-react';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';

interface ConnectorReadinessProps {
  statuses: ConnectorReadinessStatus[];
  compact?: boolean;
}

function getOverallHealth(statuses: ConnectorReadinessStatus[]): 'ready' | 'partial' | 'missing' {
  if (statuses.length === 0) return 'ready';
  const allReady = statuses.every((s) => s.health === 'ready');
  if (allReady) return 'ready';
  const anyReady = statuses.some((s) => s.health === 'ready');
  return anyReady ? 'partial' : 'missing';
}

const HEALTH_CONFIG = {
  ready: {
    Icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    label: 'Ready',
  },
  partial: {
    Icon: AlertCircle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    label: 'Partial',
  },
  missing: {
    Icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    label: 'Setup needed',
  },
} as const;

const STATUS_ICON = {
  ready: CheckCircle2,
  missing: AlertCircle,
  unhealthy: XCircle,
  unknown: HelpCircle,
} as const;

const STATUS_COLOR = {
  ready: 'text-emerald-400',
  missing: 'text-amber-400',
  unhealthy: 'text-red-400',
  unknown: 'text-muted-foreground/80',
} as const;

/**
 * Compact dot indicator or detailed readiness badge.
 */
export function ConnectorReadiness({ statuses, compact = true }: ConnectorReadinessProps) {
  const overall = getOverallHealth(statuses);
  const config = HEALTH_CONFIG[overall];
  const StatusIcon = config.Icon;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded-full border ${config.bg} ${config.color}`}
        title={`${statuses.length} connector${statuses.length !== 1 ? 's' : ''}: ${config.label}`}
      >
        <StatusIcon className="w-3 h-3" />
        {config.label}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <StatusIcon className={`w-4 h-4 ${config.color}`} />
        <span className="text-sm font-medium text-foreground/90">{config.label}</span>
      </div>
      {statuses.map((status) => {
        const Icon = STATUS_ICON[status.health];
        const color = STATUS_COLOR[status.health];
        return (
          <div key={status.connector_name} className="flex items-center gap-2 pl-6">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <span className="text-sm text-foreground/80">{status.connector_name}</span>
            {!status.has_credential && status.installed && (
              <span className="text-sm text-amber-400/60">needs credential</span>
            )}
            {!status.installed && (
              <span className="text-sm text-amber-400/60">not installed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Derive connector readiness statuses from design result and current system state.
 */
export function deriveConnectorReadiness(
  connectors: Array<{ name: string }>,
  installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
): ConnectorReadinessStatus[] {
  return connectors.map((conn) => {
    const installed = installedConnectorNames.has(conn.name);
    const has_credential = credentialServiceTypes.has(conn.name);
    const health: ConnectorReadinessStatus['health'] =
      installed && has_credential ? 'ready' : 'missing';

    return {
      connector_name: conn.name,
      installed,
      has_credential,
      health,
    };
  });
}

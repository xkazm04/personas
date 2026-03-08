import { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, KeyRound, Shield } from 'lucide-react';
import type { SuggestedConnector } from '@/lib/types/designTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { analyzeCredentialGaps, type CredentialGapEntry } from './edit/credentialGapAnalysis';

interface CredentialGapPanelProps {
  connectors: SuggestedConnector[];
  credentials: CredentialMetadata[];
  selectedConnectorNames?: Set<string>;
}

const STATUS_CONFIG = {
  ready: {
    icon: CheckCircle2,
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    label: 'Ready',
  },
  ambiguous: {
    icon: AlertTriangle,
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    label: 'Multiple matches',
  },
  missing: {
    icon: XCircle,
    badge: 'bg-red-500/10 text-red-400 border-red-500/20',
    label: 'Needs setup',
  },
} as const;

export function CredentialGapPanel({
  connectors,
  credentials,
  selectedConnectorNames,
}: CredentialGapPanelProps) {
  const result = useMemo(
    () => analyzeCredentialGaps(connectors, credentials, selectedConnectorNames),
    [connectors, credentials, selectedConnectorNames],
  );

  if (result.entries.length === 0) return null;

  const allReady = result.missingCount === 0 && result.ambiguousCount === 0;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/5 bg-gradient-to-r from-secondary/40 to-transparent">
        <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Shield className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground/90">Credential Readiness</h4>
          <p className="text-sm text-muted-foreground/70">
            {allReady
              ? 'All connectors have matching credentials'
              : `${result.missingCount} connector${result.missingCount !== 1 ? 's' : ''} need credentials before transform`}
          </p>
        </div>
        {/* Summary pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result.readyCount > 0 && (
            <span className="px-2 py-0.5 text-sm font-mono rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
              {result.readyCount} ready
            </span>
          )}
          {result.ambiguousCount > 0 && (
            <span className="px-2 py-0.5 text-sm font-mono rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
              {result.ambiguousCount} ambiguous
            </span>
          )}
          {result.missingCount > 0 && (
            <span className="px-2 py-0.5 text-sm font-mono rounded-lg bg-red-500/10 text-red-400 border border-red-500/15">
              {result.missingCount} missing
            </span>
          )}
        </div>
      </div>

      {/* Connector rows */}
      <div className="divide-y divide-primary/5">
        {result.entries.map((entry) => (
          <GapRow key={entry.connector.name} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function GapRow({ entry }: { entry: CredentialGapEntry }) {
  const config = STATUS_CONFIG[entry.status];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${
        entry.status === 'ready' ? 'text-emerald-400' :
        entry.status === 'ambiguous' ? 'text-amber-400' : 'text-red-400'
      }`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground/80">{entry.connector.name}</span>
          {entry.connector.role && (
            <span className="text-sm text-muted-foreground/50">{entry.connector.role}</span>
          )}
        </div>
        {entry.status === 'ready' && entry.matchedCredential && (
          <p className="text-sm text-muted-foreground/60 flex items-center gap-1 mt-0.5">
            <KeyRound className="w-2.5 h-2.5" />
            {entry.matchedCredential.name}
            {entry.matchedCredential.healthcheck_last_success === true && (
              <span className="text-emerald-400/70 ml-1">healthy</span>
            )}
            {entry.matchedCredential.healthcheck_last_success === false && (
              <span className="text-red-400/70 ml-1">unhealthy</span>
            )}
          </p>
        )}
        {entry.status === 'ambiguous' && (
          <p className="text-sm text-amber-400/60 mt-0.5">
            {entry.ambiguousCandidates.length} credentials match: {entry.ambiguousCandidates.map((c) => c.name).join(', ')}
          </p>
        )}
        {entry.status === 'missing' && entry.connector.setup_url && (
          <p className="text-sm text-muted-foreground/50 mt-0.5">
            Setup available at {entry.connector.setup_url}
          </p>
        )}
      </div>

      <span className={`px-2 py-0.5 text-sm font-mono rounded-lg border flex-shrink-0 ${config.badge}`}>
        {config.label}
      </span>
    </div>
  );
}

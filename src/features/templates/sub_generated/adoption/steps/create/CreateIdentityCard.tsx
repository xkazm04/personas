import {
  Wrench,
  Zap,
  Link,
  Bell,
  Shield,
} from 'lucide-react';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { BORDER_DEFAULT, BORDER_SUBTLE } from '@/lib/utils/designTokens';

interface ProtocolCapability {
  type: string;
  label: string;
  context: string;
}

interface CreateIdentityCardProps {
  draft: N8nPersonaDraft;
  toolCount: number;
  triggerCount: number;
  connectorCount: number;
  channelCount: number;
  readinessStatuses: ConnectorReadinessStatus[];
  readyCount: number;
  allConnectorsReady: boolean;
  capabilities: ProtocolCapability[];
}

export function CreateIdentityCard({
  draft,
  toolCount,
  triggerCount,
  connectorCount,
  channelCount,
  readinessStatuses,
  readyCount,
  allConnectorsReady,
  capabilities,
}: CreateIdentityCardProps) {
  return (
    <div className={`rounded-xl border ${BORDER_DEFAULT} bg-secondary/20 p-3`}>
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg border flex-shrink-0"
          style={{
            backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
            borderColor: `${draft.color ?? '#8b5cf6'}30`,
          }}
        >
          {draft.icon ?? '\u2728'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground/90">
            {draft.name ?? 'Unnamed Persona'}
          </p>
          <p className="text-sm text-muted-foreground/70 truncate">
            {draft.description ?? 'No description provided'}
          </p>
        </div>
      </div>

      {/* Inline entity badges + connector readiness */}
      <div className={`flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t ${BORDER_SUBTLE}`}>
        {toolCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-blue-500/8 text-blue-400/70 border border-blue-500/10">
            <Wrench className="w-2.5 h-2.5" /> {toolCount} Tools
          </span>
        )}
        {triggerCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-amber-500/8 text-amber-400/70 border border-amber-500/10">
            <Zap className="w-2.5 h-2.5" /> {triggerCount} Triggers
          </span>
        )}
        {connectorCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-emerald-500/8 text-emerald-400/70 border border-emerald-500/10">
            <Link className="w-2.5 h-2.5" /> {connectorCount} Connectors
          </span>
        )}
        {channelCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-violet-500/8 text-violet-400/70 border border-violet-500/10">
            <Bell className="w-2.5 h-2.5" /> {channelCount} Channels
          </span>
        )}
        {readinessStatuses.length > 0 && (
          <span className={`ml-auto text-sm ${allConnectorsReady ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
            {allConnectorsReady ? 'All connectors ready' : `${readyCount}/${readinessStatuses.length} ready`}
          </span>
        )}
      </div>

      {/* Protocol capabilities */}
      {capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {capabilities.map((cap) => (
            <span
              key={cap.type}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-full bg-cyan-500/8 text-cyan-400/60 border border-cyan-500/10"
              title={cap.context}
            >
              <Shield className="w-2.5 h-2.5" />
              {cap.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

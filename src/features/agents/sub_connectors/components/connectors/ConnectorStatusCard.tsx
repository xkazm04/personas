import { useState } from 'react';
import { Link, CheckCircle2, AlertCircle, XCircle, Activity, Loader2, ChevronDown, Plus, ArrowLeftRight } from 'lucide-react';
import type { ConnectorStatus } from '../../libs/connectorTypes';
import { STATUS_CONFIG, getStatusKey } from '../../libs/connectorTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { LinkPicker, SwapPicker, StatusResult } from './ConnectorStatusBadges';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface ConnectorStatusCardProps {
  status: ConnectorStatus;
  isLinking: boolean;
  credentials: CredentialMetadata[];
  onTest: (name: string, credentialId: string) => void;
  onToggleLinking: (name: string | null) => void;
  onLinkCredential: (connectorName: string, credentialId: string, credentialName: string) => void;
  onAddCredential: (connectorName: string) => void;
  onClearLinkError?: (connectorName: string) => void;
  roleLabel?: string;
  alternatives?: string[];
  onSwap?: (currentName: string, newName: string) => void;
}

const STATUS_ICON = {
  testing: Loader2,
  ready: CheckCircle2,
  failed: XCircle,
  missing: AlertCircle,
  untested: AlertCircle,
} as const;

export function ConnectorStatusCard({
  status, isLinking, credentials, onTest, onToggleLinking,
  onLinkCredential, onAddCredential, onClearLinkError,
  roleLabel, alternatives, onSwap,
}: ConnectorStatusCardProps) {
  const [swapOpen, setSwapOpen] = useState(false);
  const statusKey = getStatusKey(status);
  const config = STATUS_CONFIG[statusKey];

  return (
    <SectionCard size="md">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Link className="w-3.5 h-3.5 text-emerald-400/60" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground/80 truncate" title={status.name}>{status.name}</p>
            {roleLabel && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-sky-500/10 border border-sky-500/15 text-sky-400/70 whitespace-nowrap">{roleLabel}</span>
            )}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border transition-all duration-300 ease-in-out ${config.bg} ${config.color}`}>
              <span className="inline-flex transition-transform duration-300 ease-in-out">
                {(() => { const Icon = STATUS_ICON[statusKey]; return <Icon className={`w-2.5 h-2.5 ${statusKey === 'testing' ? 'animate-spin' : ''}`} />; })()}
              </span>
              <span>{config.label}</span>
            </span>
          </div>
          {status.credentialName && <p className="text-sm text-muted-foreground/80 mt-0.5">Credential: {status.credentialName}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {alternatives && alternatives.length > 0 && onSwap && (
            <button onClick={() => setSwapOpen((o) => !o)}
              className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-xl border transition-colors ${swapOpen ? 'border-sky-500/30 text-sky-300 bg-sky-500/15' : 'border-primary/20 text-muted-foreground/60 hover:bg-secondary/50 hover:text-foreground/80'}`}
              title="Swap to alternative connector"><ArrowLeftRight className="w-3 h-3" /></button>
          )}
          {status.credentialId ? (
            <Tooltip content={status.testing ? 'Test already in progress' : ''} placement="top" delay={200}>
              <button onClick={() => onTest(status.name, status.credentialId!)} disabled={status.testing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-primary/20 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {status.testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />} Test
              </button>
            </Tooltip>
          ) : (
            <>
              {credentials.length > 0 && (
                <button onClick={() => onToggleLinking(isLinking ? null : status.name)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border transition-colors ${isLinking ? 'border-violet-500/30 text-violet-300 bg-violet-500/15' : 'border-primary/20 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95'}`}>
                  <ChevronDown className={`w-3 h-3 transition-transform ${isLinking ? 'rotate-180' : ''}`} /> Link Existing
                </button>
              )}
              <button onClick={() => onAddCredential(status.name)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors">
                <Plus className="w-3 h-3" /> Add New
              </button>
            </>
          )}
        </div>
      </div>

      <LinkPicker isLinking={isLinking} status={status} credentials={credentials} onLinkCredential={onLinkCredential} />
      {alternatives && onSwap && (
        <SwapPicker swapOpen={swapOpen} alternatives={alternatives} statusName={status.name} onSwap={onSwap} onClose={() => setSwapOpen(false)} />
      )}
      <StatusResult status={status} onClearLinkError={onClearLinkError} />
    </SectionCard>
  );
}

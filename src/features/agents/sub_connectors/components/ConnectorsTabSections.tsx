import { Link, CheckCircle2, AlertCircle, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import { ConnectorStatusCard } from './ConnectorStatusCard';
import type { ConnectorStatus } from '../libs/connectorTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { getAlternatives } from '@/lib/credentials/connectorRoles';

interface ReadinessWarningsProps {
  unlinked: number;
  unhealthy: number;
}

export function ReadinessWarnings({ unlinked, unhealthy }: ReadinessWarningsProps) {
  return (
    <>
      {unlinked > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="w-4 h-4 text-amber-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-400/80">{unlinked} connector{unlinked !== 1 ? 's' : ''} missing credentials — execution blocked</p>
            <p className="text-amber-400/50 mt-0.5">Link or create credentials for all connectors to enable execution.</p>
          </div>
        </div>
      )}
      {unlinked === 0 && unhealthy > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/5 border border-red-500/15">
          <AlertCircle className="w-4 h-4 text-red-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-red-400/80">{unhealthy} connector{unhealthy !== 1 ? 's' : ''} failed healthcheck — execution may fail at runtime</p>
            <p className="text-red-400/50 mt-0.5">Re-test or re-link credentials for failing connectors.</p>
          </div>
        </div>
      )}
    </>
  );
}

interface ConnectorsSectionProps {
  roleGroups: { roleLabel: string; items: ConnectorStatus[] }[];
  requiredCredTypes: string[];
  healthy: number;
  unhealthy: number;
  unlinked: number;
  testableCount: number;
  testingAll: boolean;
  credentials: CredentialMetadata[];
  linkingConnector: string | null;
  onTestAll: () => void;
  onTestConnector: (name: string, credId: string) => void;
  onToggleLinking: (name: string | null) => void;
  onLink: (connectorName: string, credentialId: string, credentialName: string) => void;
  onAddCredential: (connectorName: string) => void;
  onClearLinkError: (connectorName: string) => void;
  onSwap: (currentName: string, newName: string) => void;
}

export function ConnectorsSection({
  roleGroups, requiredCredTypes, healthy, unhealthy, unlinked,
  testableCount, testingAll, credentials, linkingConnector,
  onTestAll, onTestConnector, onToggleLinking, onLink,
  onAddCredential, onClearLinkError, onSwap,
}: ConnectorsSectionProps) {
  if (requiredCredTypes.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<Link className="w-3.5 h-3.5" />}
        label={`${requiredCredTypes.length} connector${requiredCredTypes.length !== 1 ? 's' : ''} required`}
        badge={(
          <>
            {healthy > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="w-2.5 h-2.5" /> {healthy} healthy
              </span>
            )}
            {unhealthy > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                <AlertCircle className="w-2.5 h-2.5" /> {unhealthy} failed
              </span>
            )}
            {unlinked > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <AlertCircle className="w-2.5 h-2.5" /> {unlinked} missing
              </span>
            )}
          </>
        )}
        trailing={testableCount > 0 ? (
          <button onClick={onTestAll} disabled={testingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors duration-snap disabled:opacity-40">
            {testingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Test All
          </button>
        ) : undefined}
      />
      <div className="space-y-2">
        {roleGroups.map((group) => (
          <div key={group.items.map((s) => s.name).join(',')} className="space-y-2">
            {group.roleLabel && group.items.length > 1 && (
              <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-1 pt-1">{group.roleLabel}</p>
            )}
            {group.items.map((status) => (
              <ConnectorStatusCard
                key={status.name} status={status}
                isLinking={linkingConnector === status.name}
                credentials={credentials}
                onTest={(name, credId) => void onTestConnector(name, credId)}
                onToggleLinking={onToggleLinking}
                onLinkCredential={onLink}
                onAddCredential={onAddCredential}
                onClearLinkError={onClearLinkError}
                roleLabel={group.roleLabel || undefined}
                alternatives={getAlternatives(status.name)}
                onSwap={onSwap}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

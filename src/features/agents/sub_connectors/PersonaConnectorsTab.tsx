import { useState, useEffect } from 'react';
import { Link, CheckCircle2, AlertCircle, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { CredentialDesignModal } from '@/features/vault/sub_design/CredentialDesignModal';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import EmptyState from '@/features/shared/components/EmptyState';
import { ToolsSection } from './ToolsSection';
import { ConnectorStatusCard } from './ConnectorStatusCard';
import { UseCaseSubscriptionsSection } from './UseCaseSubscriptionsSection';
import { useConnectorStatuses } from './useConnectorStatuses';

interface PersonaConnectorsTabProps {
  onMissingCountChange?: (count: number) => void;
}

export function PersonaConnectorsTab({ onMissingCountChange }: PersonaConnectorsTabProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const {
    statuses, tools, requiredCredTypes, credentials,
    testingAll, fetchCredentials, testConnector,
    handleTestAll, handleLinkCredential,
  } = useConnectorStatuses();

  const [linkingConnector, setLinkingConnector] = useState<string | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');

  const handleAddCredential = (connectorName: string) => {
    setLinkingConnector(null);
    setDesignInstruction(`${connectorName} API credential`);
    setDesignOpen(true);
  };

  const handleDesignComplete = () => {
    setDesignOpen(false);
    setDesignInstruction('');
    void fetchCredentials().catch(() => {});
  };

  const onLink = (connectorName: string, credentialId: string, credentialName: string) => {
    handleLinkCredential(connectorName, credentialId, credentialName);
    setLinkingConnector(null);
  };

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const testableCount = statuses.filter((s) => s.credentialId).length;
  const readyCount = statuses.filter((s) => s.result?.success).length;
  const missingCount = statuses.filter((s) => !s.credentialId).length;

  // Report missing count to parent
  useEffect(() => {
    onMissingCountChange?.(missingCount);
  }, [missingCount, onMissingCountChange]);

  return (
    <div className="space-y-6">
      {/* Readiness warning */}
      {missingCount > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="w-4 h-4 text-amber-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-400/80">
              {missingCount} connector{missingCount !== 1 ? 's' : ''} need credentials before execution
            </p>
            <p className="text-amber-400/50 mt-0.5">
              Link or create credentials for all connectors to enable execution.
            </p>
          </div>
        </div>
      )}

      {/* Tools section */}
      <ToolsSection tools={tools} personaId={selectedPersona?.id} />

      {/* Connectors section */}
      {requiredCredTypes.length > 0 && (
        <div className="space-y-3">
          <SectionHeader
            icon={<Link className="w-3.5 h-3.5" />}
            label={`${requiredCredTypes.length} connector${requiredCredTypes.length !== 1 ? 's' : ''} required`}
            badge={(
              <>
                {readyCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    {readyCount} ready
                  </span>
                )}
                {missingCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                    <AlertCircle className="w-2.5 h-2.5" />
                    {missingCount} missing
                  </span>
                )}
              </>
            )}
            trailing={testableCount > 0 ? (
              <button
                onClick={() => void handleTestAll()}
                disabled={testingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors duration-snap disabled:opacity-40"
              >
                {testingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Test All
              </button>
            ) : undefined}
          />

          <div className="space-y-2">
            {statuses.map((status) => (
              <ConnectorStatusCard
                key={status.name}
                status={status}
                isLinking={linkingConnector === status.name}
                credentials={credentials}
                onTest={(name, credId) => void testConnector(name, credId)}
                onToggleLinking={setLinkingConnector}
                onLinkCredential={onLink}
                onAddCredential={handleAddCredential}
              />
            ))}
          </div>
        </div>
      )}

      {requiredCredTypes.length === 0 && tools.length === 0 && (
        <EmptyState
          icon={Link}
          title="No tools or connectors configured"
          subtitle="Add tools to your persona or link connectors to unlock automations."
          iconContainerClassName="bg-cyan-500/10 border-cyan-500/20"
          iconColor="text-cyan-400/75"
        />
      )}

      {/* Event Subscriptions per use case */}
      <UseCaseSubscriptionsSection />

      {/* Embedded credential design modal */}
      {designOpen && (
        <div className="mt-4 border border-violet-500/20 rounded-2xl overflow-hidden">
          <CredentialDesignModal
            open={designOpen}
            embedded
            initialInstruction={designInstruction}
            onClose={() => { setDesignOpen(false); setDesignInstruction(''); }}
            onComplete={handleDesignComplete}
          />
        </div>
      )}
    </div>
  );
}

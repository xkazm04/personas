import { useState, useEffect, useMemo } from 'react';
import { Link, CheckCircle2, AlertCircle, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { CredentialDesignModal } from '@/features/vault/sub_design/CredentialDesignModal';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import EmptyState from '@/features/shared/components/EmptyState';
import { ToolsSection } from './ToolsSection';
import { AutomationsSection } from './AutomationsSection';
import { AutomationSetupModal } from './AutomationSetupModal';
import { ConnectorStatusCard } from './ConnectorStatusCard';
import { UseCaseSubscriptionsSection } from './UseCaseSubscriptionsSection';
import { AgentCredentialDemands } from './AgentCredentialDemands';
import { useConnectorStatuses } from './useConnectorStatuses';
import { getRoleForConnector, getAlternatives } from '@/lib/credentials/connectorRoles';
import type { ConnectorStatus } from './connectorTypes';

interface PersonaConnectorsTabProps {
  onMissingCountChange?: (count: number) => void;
}

export function PersonaConnectorsTab({ onMissingCountChange }: PersonaConnectorsTabProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const {
    statuses, tools, requiredCredTypes, credentials,
    testingAll, readinessCounts, fetchCredentials, testConnector,
    handleTestAll, handleLinkCredential, clearLinkError,
  } = useConnectorStatuses();

  const [linkingConnector, setLinkingConnector] = useState<string | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);

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

  // Group statuses by functional role
  const roleGroups = useMemo(() => {
    const groups: { roleLabel: string; items: ConnectorStatus[] }[] = [];
    const grouped = new Set<string>();

    for (const s of statuses) {
      if (grouped.has(s.name)) continue;
      const role = getRoleForConnector(s.name);
      if (role) {
        // Collect all statuses that share this role
        const members = statuses.filter((st) => role.members.includes(st.name));
        for (const m of members) grouped.add(m.name);
        groups.push({ roleLabel: role.label, items: members });
      } else {
        grouped.add(s.name);
        groups.push({ roleLabel: '', items: [s] });
      }
    }
    return groups;
  }, [statuses]);

  const handleSwap = (_currentName: string, newName: string) => {
    // Swap means: user wants newName instead of currentName.
    // Open credential design for the new connector so they can link it.
    handleAddCredential(newName);
  };

  const onLink = async (connectorName: string, credentialId: string, credentialName: string) => {
    setLinkingConnector(null);
    const success = await handleLinkCredential(connectorName, credentialId, credentialName);
    if (!success) {
      // Re-open the linking dropdown so the user can try again
      setLinkingConnector(connectorName);
    }
  };

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const { unlinked, healthy, unhealthy } = readinessCounts;
  const testableCount = statuses.length - unlinked;

  // Report unlinked count to parent (blocks execution)
  useEffect(() => {
    onMissingCountChange?.(unlinked);
  }, [unlinked, onMissingCountChange]);

  return (
    <div className="space-y-6">
      {/* Demand-driven credential prompts */}
      <AgentCredentialDemands />

      {/* Readiness warnings */}
      {unlinked > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="w-4 h-4 text-amber-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-400/80">
              {unlinked} connector{unlinked !== 1 ? 's' : ''} missing credentials — execution blocked
            </p>
            <p className="text-amber-400/50 mt-0.5">
              Link or create credentials for all connectors to enable execution.
            </p>
          </div>
        </div>
      )}
      {unlinked === 0 && unhealthy > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/5 border border-red-500/15">
          <AlertCircle className="w-4 h-4 text-red-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-red-400/80">
              {unhealthy} connector{unhealthy !== 1 ? 's' : ''} failed healthcheck — execution may fail at runtime
            </p>
            <p className="text-red-400/50 mt-0.5">
              Re-test or re-link credentials for failing connectors.
            </p>
          </div>
        </div>
      )}

      {/* Tools section */}
      <ToolsSection tools={tools} personaId={selectedPersona?.id} />

      {/* Automations section */}
      <AutomationsSection
        automations={selectedPersona?.automations ?? []}
        onAdd={() => setAutomationModalOpen(true)}
        onEdit={(id) => { setEditingAutomationId(id); setAutomationModalOpen(true); }}
      />

      {/* Connectors section */}
      {requiredCredTypes.length > 0 && (
        <div className="space-y-3">
          <SectionHeader
            icon={<Link className="w-3.5 h-3.5" />}
            label={`${requiredCredTypes.length} connector${requiredCredTypes.length !== 1 ? 's' : ''} required`}
            badge={(
              <>
                {healthy > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    {healthy} healthy
                  </span>
                )}
                {unhealthy > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                    <AlertCircle className="w-2.5 h-2.5" />
                    {unhealthy} failed
                  </span>
                )}
                {unlinked > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                    <AlertCircle className="w-2.5 h-2.5" />
                    {unlinked} missing
                  </span>
                )}
              </>
            )}
            trailing={testableCount > 0 ? (
              <button
                onClick={() => void handleTestAll()}
                disabled={testingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors duration-snap disabled:opacity-40"
              >
                {testingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Test All
              </button>
            ) : undefined}
          />

          <div className="space-y-2">
            {roleGroups.map((group) => (
              <div key={group.items.map((s) => s.name).join(',')} className="space-y-2">
                {group.roleLabel && group.items.length > 1 && (
                  <p className="text-[11px] font-semibold text-muted-foreground/40 uppercase tracking-wider px-1 pt-1">
                    {group.roleLabel}
                  </p>
                )}
                {group.items.map((status) => (
                  <ConnectorStatusCard
                    key={status.name}
                    status={status}
                    isLinking={linkingConnector === status.name}
                    credentials={credentials}
                    onTest={(name, credId) => void testConnector(name, credId)}
                    onToggleLinking={setLinkingConnector}
                    onLinkCredential={onLink}
                    onAddCredential={handleAddCredential}
                    onClearLinkError={clearLinkError}
                    roleLabel={group.roleLabel || undefined}
                    alternatives={getAlternatives(status.name)}
                    onSwap={handleSwap}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {requiredCredTypes.length === 0 && tools.length === 0 && (selectedPersona?.automations ?? []).length === 0 && (
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

      {/* Automation setup modal */}
      <AutomationSetupModal
        open={automationModalOpen}
        personaId={selectedPersona.id}
        onClose={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }}
        onComplete={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }}
        editAutomationId={editingAutomationId}
      />

      {/* Embedded credential design modal */}
      {designOpen && (
        <div className="mt-4 border border-violet-500/20 rounded-xl overflow-hidden">
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

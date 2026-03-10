import { useState, useEffect, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { CredentialDesignModal } from '@/features/vault/sub_design/CredentialDesignModal';
import EmptyState from '@/features/shared/components/EmptyState';
import { ToolsSection } from './ToolsSection';
import { AutomationsSection } from './AutomationsSection';
import { AutomationSetupModal } from './AutomationSetupModal';
import { UseCaseSubscriptionsSection } from './UseCaseSubscriptionsSection';
import { AgentCredentialDemands } from './AgentCredentialDemands';
import { useConnectorStatuses } from '../libs/useConnectorStatuses';
import { getRoleForConnector } from '@/lib/credentials/connectorRoles';
import type { ConnectorStatus } from '../libs/connectorTypes';
import { ReadinessWarnings, ConnectorsSection } from './ConnectorsTabSections';

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
    setDesignOpen(false); setDesignInstruction('');
    void fetchCredentials().catch(() => {});
  };

  const roleGroups = useMemo(() => {
    const groups: { roleLabel: string; items: ConnectorStatus[] }[] = [];
    const grouped = new Set<string>();
    for (const s of statuses) {
      if (grouped.has(s.name)) continue;
      const role = getRoleForConnector(s.name);
      if (role) {
        const members = statuses.filter((st) => role.members.includes(st.name));
        for (const m of members) grouped.add(m.name);
        groups.push({ roleLabel: role.label, items: members });
      } else { grouped.add(s.name); groups.push({ roleLabel: '', items: [s] }); }
    }
    return groups;
  }, [statuses]);

  const handleSwap = (_currentName: string, newName: string) => { handleAddCredential(newName); };

  const onLink = async (connectorName: string, credentialId: string, credentialName: string) => {
    setLinkingConnector(null);
    const success = await handleLinkCredential(connectorName, credentialId, credentialName);
    if (!success) setLinkingConnector(connectorName);
  };

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground/80">No persona selected</div>;
  }

  const { unlinked, healthy, unhealthy } = readinessCounts;
  const testableCount = statuses.length - unlinked;

  useEffect(() => { onMissingCountChange?.(unlinked); }, [unlinked, onMissingCountChange]);

  return (
    <div className="space-y-6">
      <AgentCredentialDemands />
      <ReadinessWarnings unlinked={unlinked} unhealthy={unhealthy} />
      <ToolsSection tools={tools} personaId={selectedPersona?.id} />
      <AutomationsSection automations={selectedPersona?.automations ?? []} onAdd={() => setAutomationModalOpen(true)} onEdit={(id) => { setEditingAutomationId(id); setAutomationModalOpen(true); }} />
      <ConnectorsSection
        roleGroups={roleGroups} requiredCredTypes={requiredCredTypes}
        healthy={healthy} unhealthy={unhealthy} unlinked={unlinked}
        testableCount={testableCount} testingAll={testingAll}
        credentials={credentials} linkingConnector={linkingConnector}
        onTestAll={() => void handleTestAll()} onTestConnector={testConnector}
        onToggleLinking={setLinkingConnector} onLink={onLink}
        onAddCredential={handleAddCredential} onClearLinkError={clearLinkError}
        onSwap={handleSwap}
      />
      {requiredCredTypes.length === 0 && tools.length === 0 && (selectedPersona?.automations ?? []).length === 0 && (
        <EmptyState variant="connectors-empty" />
      )}
      <UseCaseSubscriptionsSection />
      <AutomationSetupModal open={automationModalOpen} personaId={selectedPersona.id} onClose={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }} onComplete={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }} editAutomationId={editingAutomationId} />
      {designOpen && (
        <div className="mt-4 border border-violet-500/20 rounded-xl overflow-hidden">
          <CredentialDesignModal open={designOpen} embedded initialInstruction={designInstruction} onClose={() => { setDesignOpen(false); setDesignInstruction(''); }} onComplete={handleDesignComplete} />
        </div>
      )}
    </div>
  );
}

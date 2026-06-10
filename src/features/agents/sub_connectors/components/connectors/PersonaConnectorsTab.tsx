import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from "@/stores/agentStore";
import { CredentialDesignModal } from '@/features/vault/sub_catalog/components/design/CredentialDesignModal';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ToolsSection } from './ToolsSection';
import { AutomationsSection } from '../automation/AutomationsSection';
import { AutomationSetupModal } from '../automation/AutomationSetupModal';
import { AgentCredentialDemands } from './AgentCredentialDemands';
import { useConnectorStatuses } from '../../libs/useConnectorStatuses';
import { silentCatch } from "@/lib/silentCatch";
import { ReadinessWarnings } from './ConnectorsTabSections';
import { extractConnectorNames } from '@/lib/personas/utils';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';

interface PersonaConnectorsTabProps {
  onMissingCountChange?: (count: number) => void;
}

export function PersonaConnectorsTab({ onMissingCountChange }: PersonaConnectorsTabProps) {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const {
    tools, requiredCredTypes,
    readinessCounts, fetchCredentials,
  } = useConnectorStatuses();

  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);

  const handleDesignComplete = () => {
    setDesignOpen(false); setDesignInstruction('');
    void fetchCredentials().catch(silentCatch("PersonaConnectorsTab:fetchCredentialsOnDesignComplete"));
  };

  const { unlinked, unhealthy } = readinessCounts;

  useEffect(() => { onMissingCountChange?.(unlinked); }, [unlinked, onMissingCountChange]);

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-foreground">{t.agents.connectors.ct_no_persona}</div>;
  }

  const connectorNames = selectedPersona ? extractConnectorNames(selectedPersona, 10) : [];

  return (
    <div className="space-y-6">
      {/* Connector icons row */}
      {connectorNames.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <span className="typo-submodule-header">{t.agents.connectors.ct_connectors_label}</span>
          <div className="flex items-center gap-1.5">
            {connectorNames.map((name, i) => {
              const meta = getConnectorMeta(name);
              return (
                <div key={`${name}-${i}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-card bg-secondary/30 border border-primary/10" title={meta.label}>
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                  <span className="typo-caption text-foreground">{meta.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <AgentCredentialDemands />
      <ReadinessWarnings unlinked={unlinked} unhealthy={unhealthy} />
      <ToolsSection tools={tools} personaId={selectedPersona?.id} />
      <AutomationsSection automations={selectedPersona?.automations ?? []} onAdd={() => setAutomationModalOpen(true)} onEdit={(id) => { setEditingAutomationId(id); setAutomationModalOpen(true); }} />
      {requiredCredTypes.length === 0 && tools.length === 0 && (selectedPersona?.automations ?? []).length === 0 && (
        <EmptyState variant="connectors-empty" />
      )}
      <AutomationSetupModal open={automationModalOpen} personaId={selectedPersona.id} onClose={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }} onComplete={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }} editAutomationId={editingAutomationId} />
      {designOpen && (
        <div className="mt-4 border border-violet-500/20 rounded-modal overflow-hidden">
          <CredentialDesignModal open={designOpen} embedded initialInstruction={designInstruction} onClose={() => { setDesignOpen(false); setDesignInstruction(''); }} onComplete={handleDesignComplete} />
        </div>
      )}
    </div>
  );
}

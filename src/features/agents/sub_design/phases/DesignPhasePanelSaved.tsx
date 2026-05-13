import { DesignResultPreview } from '@/features/templates/sub_generated';
import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { allIndices } from '../DesignTabHelpers';
import { PersonaParametersCard } from '../components/PersonaParametersCard';

interface DesignPhasePanelSavedProps {
  savedDesignResult: AgentIR;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: PersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function DesignPhasePanelSaved({
  savedDesignResult,
  selectedPersona,
  toolDefinitions,
  currentToolNames,
  credentials,
  connectorDefinitions,
}: DesignPhasePanelSavedProps) {
  return (
    <>
      <PersonaParametersCard />
      <DesignResultPreview
        result={savedDesignResult}
        allToolDefs={toolDefinitions}
        currentToolNames={currentToolNames}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        selectedTools={new Set(savedDesignResult.suggested_tools)}
        selectedTriggerIndices={allIndices(savedDesignResult.suggested_triggers)}
        selectedChannelIndices={allIndices(savedDesignResult.suggested_notification_channels)}
        suggestedSubscriptions={savedDesignResult.suggested_event_subscriptions}
        selectedSubscriptionIndices={allIndices(savedDesignResult.suggested_event_subscriptions)}
        onToolToggle={() => {}}
        onTriggerToggle={() => {}}
        onChannelToggle={() => {}}
        onConnectorClick={() => {}}
        readOnly
        actualTriggers={selectedPersona.triggers || []}
        feasibility={savedDesignResult.feasibility}
      />
    </>
  );
}

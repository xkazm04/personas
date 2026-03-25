import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { ConnectorsSection } from './ConnectorsSection';
import { EventsSection } from './EventsSection';
import { MessagesSection } from './MessagesSection';
import { DesignTestResults } from './DesignTestResults';
import type { AgentIR, DesignTestResult, SuggestedConnector } from '@/lib/types/designTypes';
import type { PersonaToolDefinition, PersonaTrigger, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DesignResultPreviewProps {
  result: AgentIR;
  allToolDefs: PersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions?: ConnectorDefinition[];
  selectedTools: Set<string>;
  selectedTriggerIndices: Set<number>;
  selectedChannelIndices?: Set<number>;
  suggestedSubscriptions?: Array<{ event_type: string; source_filter?: object; description: string }>;
  selectedSubscriptionIndices?: Set<number>;
  onToolToggle: (toolName: string) => void;
  onTriggerToggle: (index: number) => void;
  onChannelToggle?: (index: number) => void;
  onSubscriptionToggle?: (idx: number) => void;
  onConnectorClick?: (connector: SuggestedConnector) => void;
  readOnly?: boolean;
  actualTriggers?: PersonaTrigger[];
  onTriggerEnabledToggle?: (triggerId: string, enabled: boolean) => void;
  feasibility?: DesignTestResult | null;
}

export function DesignResultPreview({
  result,
  allToolDefs,
  currentToolNames,
  credentials,
  connectorDefinitions = [],
  selectedTools,
  selectedTriggerIndices,
  selectedChannelIndices = new Set(),
  suggestedSubscriptions,
  selectedSubscriptionIndices = new Set(),
  onToolToggle,
  onTriggerToggle,
  onChannelToggle,
  onSubscriptionToggle,
  onConnectorClick,
  readOnly = false,
  actualTriggers = [],
  onTriggerEnabledToggle,
  feasibility,
}: DesignResultPreviewProps) {
  const rawChannels = result.suggested_notification_channels;
  const suggestedChannels = Array.isArray(rawChannels) ? rawChannels : [];

  return (
    <div className="space-y-6">
      <PromptTabsPreview designResult={result} />

      <ConnectorsSection
        result={result}
        allToolDefs={allToolDefs}
        currentToolNames={currentToolNames}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        selectedTools={selectedTools}
        onToolToggle={onToolToggle}
        onConnectorClick={onConnectorClick}
        readOnly={readOnly}
      />

      <EventsSection
        result={result}
        selectedTriggerIndices={selectedTriggerIndices}
        onTriggerToggle={onTriggerToggle}
        suggestedSubscriptions={suggestedSubscriptions}
        selectedSubscriptionIndices={selectedSubscriptionIndices}
        onSubscriptionToggle={onSubscriptionToggle}
        readOnly={readOnly}
        actualTriggers={actualTriggers}
        onTriggerEnabledToggle={onTriggerEnabledToggle}
      />

      <MessagesSection
        channels={suggestedChannels}
        selectedChannelIndices={selectedChannelIndices}
        onChannelToggle={onChannelToggle}
        readOnly={readOnly}
      />

      {feasibility && <DesignTestResults result={feasibility} />}
    </div>
  );
}

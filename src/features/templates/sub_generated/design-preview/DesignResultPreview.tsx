import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { DesignSummaryBar, type DesignSection } from './DesignSummaryBar';
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
  /** When true, suppress the IR-derived ConnectorsSection. Used by the
   *  persona Design tab (saved state) where a separate live
   *  PersonaConnectorsTab below is the source of truth for credential
   *  bindings + healthcheck. Without this flag the IR section showed
   *  stale "Credential ready" badges that didn't reflect actual link
   *  state and duplicated the section heading visible just below. */
  hideConnectors?: boolean;
  /** Suppress the Events & Triggers section — used where it lives in its own
   *  tab (the persona Design hub's Events sub-tab). */
  hideEvents?: boolean;
  /** Suppress the Messages & Notifications section — used where it lives in its
   *  own tab (the persona Design hub's Notifications sub-tab). */
  hideMessages?: boolean;
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
  hideConnectors = false,
  hideEvents = false,
  hideMessages = false,
}: DesignResultPreviewProps) {
  const rawChannels = result.suggested_notification_channels;
  const suggestedChannels = Array.isArray(rawChannels) ? rawChannels : [];

  const handleJump = (target: DesignSection) => {
    document.getElementById(`design-section-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-6">
      <DesignSummaryBar
        result={result}
        channelCount={suggestedChannels.length}
        subscriptionCount={suggestedSubscriptions?.length ?? 0}
        feasibility={feasibility}
        onJump={handleJump}
      />

      <PromptTabsPreview designResult={result} />

      {!hideConnectors && (
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
          anchorId="design-section-connectors"
        />
      )}

      {!hideEvents && (
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
          anchorId="design-section-events"
        />
      )}

      {!hideMessages && (
        <MessagesSection
          channels={suggestedChannels}
          selectedChannelIndices={selectedChannelIndices}
          onChannelToggle={onChannelToggle}
          readOnly={readOnly}
          anchorId="design-section-messages"
        />
      )}

      {feasibility && <DesignTestResults result={feasibility} />}
    </div>
  );
}

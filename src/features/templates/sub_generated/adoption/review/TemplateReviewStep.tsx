import { ConnectorReadiness } from '../../shared/ConnectorReadiness';
import { DimensionRadial } from '../../shared/DimensionRadial';
import type { AgentIR, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import {
  UseCasesSection,
  ToolsSection,
  TriggersSection,
  ConnectorsSection,
  ChannelsSection,
  EventsSection,
} from './ReviewSections';
import { BORDER_DEFAULT, DIVIDE_SUBTLE, CARD_PADDING } from '@/lib/utils/designTokens';

interface TemplateReviewStepProps {
  designResult: AgentIR;
  reviewInstruction: string;
  selectedUseCaseIds: Set<string>;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  selectedChannelIndices: Set<number>;
  selectedEventIndices: Set<number>;
  onToggleUseCaseId: (id: string) => void;
  onToggleTool: (index: number) => void;
  onToggleTrigger: (index: number) => void;
  onToggleConnector: (name: string) => void;
  onToggleChannel: (index: number) => void;
  onToggleEvent: (index: number) => void;
  readinessStatuses: ConnectorReadinessStatus[];
  useCaseFlows: UseCaseFlow[];
}

export function TemplateReviewStep({
  designResult,
  reviewInstruction,
  selectedUseCaseIds,
  selectedToolIndices,
  selectedTriggerIndices,
  selectedConnectorNames,
  selectedChannelIndices,
  selectedEventIndices,
  onToggleUseCaseId,
  onToggleTool,
  onToggleTrigger,
  onToggleConnector,
  onToggleChannel,
  onToggleEvent,
  readinessStatuses,
  useCaseFlows,
}: TemplateReviewStepProps) {
  const toolCount = selectedToolIndices.size;
  const triggerCount = selectedTriggerIndices.size;
  const connectorCount = selectedConnectorNames.size;
  const channelCount = selectedChannelIndices.size;
  const eventCount = selectedEventIndices.size;
  const useCaseCount = selectedUseCaseIds.size;

  const hasTools = designResult.suggested_tools.length > 0;
  const hasTriggers = designResult.suggested_triggers.length > 0;
  const hasConnectors = (designResult.suggested_connectors?.length ?? 0) > 0;
  const hasChannels = (designResult.suggested_notification_channels?.length ?? 0) > 0;
  const hasEvents = (designResult.suggested_event_subscriptions?.length ?? 0) > 0;
  const hasUseCases = useCaseFlows.length > 0;

  return (
    <div className="space-y-4">
      {/* Header: summary text + dimension radial */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-foreground/80 leading-relaxed flex-1">
          {designResult.summary || reviewInstruction}
        </p>
        <DimensionRadial designResult={designResult} size={48} className="flex-shrink-0" />
      </div>

      {/* Selection summary pills */}
      <div className="flex items-center gap-2 flex-wrap text-sm font-mono uppercase tracking-wider text-muted-foreground/45">
        {hasTools && (
          <span className="px-2.5 py-1 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/15">
            {toolCount} tool{toolCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasTriggers && (
          <span className="px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/15">
            {triggerCount} trigger{triggerCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasConnectors && (
          <span className="px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            {connectorCount} connector{connectorCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasChannels && (
          <span className="px-2.5 py-1 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/15">
            {channelCount} channel{channelCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasEvents && (
          <span className="px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/15">
            {eventCount} event{eventCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasUseCases && (
          <span className="px-2.5 py-1 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/15">
            {useCaseCount} use case{useCaseCount !== 1 ? 's' : ''}
          </span>
        )}
        <span className="text-muted-foreground/80 ml-1 normal-case tracking-normal font-sans">selected</span>
      </div>

      {/* Sections card */}
      <div className={`rounded-xl border ${BORDER_DEFAULT} bg-secondary/20 divide-y ${DIVIDE_SUBTLE}`}>
        {hasUseCases && (
          <UseCasesSection
            useCaseFlows={useCaseFlows}
            selectedUseCaseIds={selectedUseCaseIds}
            onToggleUseCaseId={onToggleUseCaseId}
          />
        )}
        {hasTools && (
          <ToolsSection
            tools={designResult.suggested_tools}
            selectedToolIndices={selectedToolIndices}
            onToggleTool={onToggleTool}
          />
        )}
        {hasTriggers && (
          <TriggersSection
            triggers={designResult.suggested_triggers}
            selectedTriggerIndices={selectedTriggerIndices}
            onToggleTrigger={onToggleTrigger}
          />
        )}
        {hasConnectors && designResult.suggested_connectors && (
          <ConnectorsSection
            connectors={designResult.suggested_connectors}
            selectedConnectorNames={selectedConnectorNames}
            onToggleConnector={onToggleConnector}
          />
        )}
        {hasChannels && designResult.suggested_notification_channels && (
          <ChannelsSection
            channels={designResult.suggested_notification_channels}
            selectedChannelIndices={selectedChannelIndices}
            onToggleChannel={onToggleChannel}
          />
        )}
        {hasEvents && designResult.suggested_event_subscriptions && (
          <EventsSection
            events={designResult.suggested_event_subscriptions}
            selectedEventIndices={selectedEventIndices}
            onToggleEvent={onToggleEvent}
          />
        )}
      </div>

      {/* Connector Readiness */}
      {readinessStatuses.length > 0 && (
        <div className={`rounded-xl border ${BORDER_DEFAULT} bg-secondary/20 ${CARD_PADDING.standard}`}>
          <ConnectorReadiness statuses={readinessStatuses} compact={false} />
        </div>
      )}
    </div>
  );
}

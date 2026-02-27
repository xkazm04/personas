import { Wrench, Zap, Link, Bell, Radio, Workflow } from 'lucide-react';
import { SelectionCheckbox } from './SelectionCheckbox';
import { ConnectorReadiness } from '../ConnectorReadiness';
import { DimensionRadial } from '../DimensionRadial';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import type { DesignAnalysisResult, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

interface TemplateReviewStepProps {
  designResult: DesignAnalysisResult;
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
          <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/15">
            {toolCount} tool{toolCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasTriggers && (
          <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
            {triggerCount} trigger{triggerCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasConnectors && (
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            {connectorCount} connector{connectorCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasChannels && (
          <span className="px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/15">
            {channelCount} channel{channelCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasEvents && (
          <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/15">
            {eventCount} event{eventCount !== 1 ? 's' : ''}
          </span>
        )}
        {hasUseCases && (
          <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/15">
            {useCaseCount} use case{useCaseCount !== 1 ? 's' : ''}
          </span>
        )}
        <span className="text-muted-foreground/80 ml-1 normal-case tracking-normal font-sans">selected</span>
      </div>

      {/* Sections card */}
      <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
        {/* Use Cases */}
        {hasUseCases && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Workflow className="w-3 h-3" />
              Use Cases ({useCaseFlows.length})
            </h4>
            <div className="space-y-1.5">
              {useCaseFlows.map((flow) => {
                const isSelected = selectedUseCaseIds.has(flow.id);
                return (
                  <div
                    key={flow.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 cursor-pointer hover:bg-primary/5 ${
                      isSelected
                        ? 'bg-cyan-500/5 border-cyan-500/15'
                        : 'bg-secondary/20 border-primary/10 opacity-50'
                    }`}
                    onClick={() => onToggleUseCaseId(flow.id)}
                  >
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={() => onToggleUseCaseId(flow.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium ${isSelected ? 'text-foreground/90' : 'text-muted-foreground/80'}`}>
                        {flow.name}
                      </span>
                      {flow.description && (
                        <p className={`text-xs truncate ${isSelected ? 'text-foreground/60' : 'text-muted-foreground/60'}`}>
                          {flow.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tools */}
        {hasTools && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              Tools ({designResult.suggested_tools.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {designResult.suggested_tools.map((tool, i) => {
                const isSelected = selectedToolIndices.has(i);
                return (
                  <div
                    key={tool}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150 cursor-pointer hover:opacity-80 ${
                      isSelected
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
                    }`}
                    onClick={() => onToggleTool(i)}
                  >
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={() => onToggleTool(i)}
                    />
                    <span className="text-sm font-mono">{tool}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Triggers */}
        {hasTriggers && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Triggers ({designResult.suggested_triggers.length})
            </h4>
            <div className="space-y-2">
              {designResult.suggested_triggers.map((trigger, i) => {
                const isSelected = selectedTriggerIndices.has(i);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 cursor-pointer hover:opacity-80 ${
                      isSelected
                        ? 'bg-amber-500/5 border-amber-500/15'
                        : 'bg-secondary/20 border-primary/10 opacity-50'
                    }`}
                    onClick={() => onToggleTrigger(i)}
                  >
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={() => onToggleTrigger(i)}
                    />
                    <span className={`px-1.5 py-0.5 text-sm font-mono rounded border ${
                      isSelected
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10'
                    }`}>
                      {trigger.trigger_type}
                    </span>
                    <span className={`text-sm truncate ${isSelected ? 'text-foreground/80' : 'text-muted-foreground/80'}`}>
                      {trigger.description}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connectors */}
        {hasConnectors && designResult.suggested_connectors && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Link className="w-3 h-3" />
              Connectors ({designResult.suggested_connectors.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {designResult.suggested_connectors.map((conn) => {
                const isSelected = selectedConnectorNames.has(conn.name);
                const meta = getConnectorMeta(conn.name);
                return (
                  <div
                    key={conn.name}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150 cursor-pointer hover:opacity-80 ${
                      isSelected
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
                    }`}
                    onClick={() => onToggleConnector(conn.name)}
                  >
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={() => onToggleConnector(conn.name)}
                    />
                    <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notification Channels */}
        {hasChannels && designResult.suggested_notification_channels && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Bell className="w-3 h-3" />
              Channels ({designResult.suggested_notification_channels.length})
            </h4>
            <div className="space-y-2">
              {designResult.suggested_notification_channels.map((channel, i) => {
                const isSelected = selectedChannelIndices.has(i);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 cursor-pointer hover:opacity-80 ${
                      isSelected
                        ? 'bg-purple-500/5 border-purple-500/15'
                        : 'bg-secondary/20 border-primary/10 opacity-50'
                    }`}
                    onClick={() => onToggleChannel(i)}
                  >
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={() => onToggleChannel(i)}
                    />
                    <span className={`px-1.5 py-0.5 text-sm font-mono rounded border ${
                      isSelected
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10'
                    }`}>
                      {channel.type}
                    </span>
                    <span className={`text-sm truncate ${isSelected ? 'text-foreground/80' : 'text-muted-foreground/80'}`}>
                      {channel.description}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Event Subscriptions */}
        {hasEvents && designResult.suggested_event_subscriptions && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Radio className="w-3 h-3" />
              Events ({designResult.suggested_event_subscriptions.length})
            </h4>
            <div className="space-y-2">
              {designResult.suggested_event_subscriptions.map((event, i) => {
                const isSelected = selectedEventIndices.has(i);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 cursor-pointer hover:opacity-80 ${
                      isSelected
                        ? 'bg-rose-500/5 border-rose-500/15'
                        : 'bg-secondary/20 border-primary/10 opacity-50'
                    }`}
                    onClick={() => onToggleEvent(i)}
                  >
                    <SelectionCheckbox
                      checked={isSelected}
                      onChange={() => onToggleEvent(i)}
                    />
                    <span className={`px-1.5 py-0.5 text-sm font-mono rounded border ${
                      isSelected
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10'
                    }`}>
                      {event.event_type}
                    </span>
                    <span className={`text-sm truncate ${isSelected ? 'text-foreground/80' : 'text-muted-foreground/80'}`}>
                      {event.description}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Connector Readiness */}
      {readinessStatuses.length > 0 && (
        <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4">
          <ConnectorReadiness statuses={readinessStatuses} compact={false} />
        </div>
      )}
    </div>
  );
}

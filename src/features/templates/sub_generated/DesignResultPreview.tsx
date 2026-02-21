import { useState, useMemo } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Zap,
  Plug,
  AlertCircle,
  Bell,
  Hash,
  Send,
  Mail,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Wrench,
  Brain,
  FileText,
  Code2,
  ShieldAlert,
  Sparkles,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import { DesignCheckbox } from '@/features/templates/sub_generated/DesignCheckbox';
import { DesignTestResults } from '@/features/templates/sub_generated/DesignTestResults';
import type { DesignAnalysisResult, DesignTestResult, SuggestedTrigger, SuggestedConnector } from '@/lib/types/designTypes';
import type { DbPersonaToolDefinition, DbPersonaTrigger, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';

// ============================================================================
// Types
// ============================================================================

interface DesignResultPreviewProps {
  result: DesignAnalysisResult;
  allToolDefs: DbPersonaToolDefinition[];
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
  actualTriggers?: DbPersonaTrigger[];
  onTriggerEnabledToggle?: (triggerId: string, enabled: boolean) => void;
  feasibility?: DesignTestResult | null;
}

interface PromptTab {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  content: string;
}

// ============================================================================
// Helpers
// ============================================================================

function triggerIcon(type: SuggestedTrigger['trigger_type']) {
  const meta = TRIGGER_TYPE_META[type] || DEFAULT_TRIGGER_META;
  const Icon = meta.Icon;
  return <Icon className={`w-4 h-4 ${meta.color}`} />;
}

function channelIcon(type: string) {
  switch (type) {
    case 'slack':
      return <Hash className="w-4 h-4 text-blue-400" />;
    case 'telegram':
      return <Send className="w-4 h-4 text-blue-400" />;
    case 'email':
      return <Mail className="w-4 h-4 text-blue-400" />;
    default:
      return <Bell className="w-4 h-4 text-blue-400" />;
  }
}

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2';

// ============================================================================
// PromptTabsPreview — Tab-based structured prompt viewer
// ============================================================================

function PromptTabsPreview({ result }: { result: DesignAnalysisResult }) {
  const tabs = useMemo<PromptTab[]>(() => {
    const sp = result.structured_prompt;
    const list: PromptTab[] = [];
    if (sp.identity) list.push({ key: 'identity', label: 'Identity', Icon: Brain, content: sp.identity });
    if (sp.instructions) list.push({ key: 'instructions', label: 'Instructions', Icon: FileText, content: sp.instructions });
    if (sp.toolGuidance) list.push({ key: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench, content: sp.toolGuidance });
    if (sp.examples) list.push({ key: 'examples', label: 'Examples', Icon: Code2, content: sp.examples });
    if (sp.errorHandling) list.push({ key: 'errorHandling', label: 'Error Handling', Icon: ShieldAlert, content: sp.errorHandling });
    if (sp.customSections) {
      for (const cs of sp.customSections) {
        list.push({ key: `custom_${cs.key}`, label: cs.label, Icon: Sparkles, content: cs.content });
      }
    }
    return list;
  }, [result.structured_prompt]);

  const [activeTab, setActiveTab] = useState(tabs[0]?.key ?? '');
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const activeSection = tabs.find((t) => t.key === activeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-0 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const TabIcon = tab.Icon;
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border border-b-0 transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-violet-500/10 border-violet-500/20 text-violet-300'
                  : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/40'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="border-t border-primary/10">
        <AnimatePresence mode="wait">
          {activeSection && (
            <motion.div
              key={activeSection.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="max-h-[400px] overflow-y-auto p-4"
            >
              <MarkdownRenderer content={activeSection.content} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Full prompt toggle */}
      {result.full_prompt_markdown && (
        <div className="border-t border-primary/10">
          <button
            onClick={() => setShowFullPrompt(!showFullPrompt)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors w-full"
          >
            <Eye className="w-3.5 h-3.5" />
            {showFullPrompt ? 'Hide' : 'View'} Full Prompt
            {showFullPrompt ? (
              <ChevronDown className="w-3 h-3 ml-auto" />
            ) : (
              <ChevronRight className="w-3 h-3 ml-auto" />
            )}
          </button>
          <AnimatePresence>
            {showFullPrompt && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="max-h-[500px] overflow-y-auto px-4 pb-4 border-t border-primary/[0.06]">
                  <MarkdownRenderer content={result.full_prompt_markdown} className="mt-3" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ConnectorsSection — Integration cards with credential status and tools
// ============================================================================

function ConnectorsSection({
  result,
  allToolDefs,
  currentToolNames,
  credentials,
  connectorDefinitions,
  selectedTools,
  onToolToggle,
  onConnectorClick,
  readOnly,
}: {
  result: DesignAnalysisResult;
  allToolDefs: DbPersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  selectedTools: Set<string>;
  onToolToggle: (toolName: string) => void;
  onConnectorClick?: (connector: SuggestedConnector) => void;
  readOnly: boolean;
}) {
  const credentialTypes = new Set(credentials.map((c) => c.service_type));
  const connectorNames = new Set(connectorDefinitions.map((c) => c.name));
  const suggestedConnectors = result.suggested_connectors ?? [];

  // Build connector → tools mapping
  const connectorToolMap = useMemo(() => {
    const linkedTools = new Set<string>();
    const map: Array<{ connector: SuggestedConnector; connDef: ConnectorDefinition | undefined; tools: string[] }> = [];

    for (const conn of suggestedConnectors) {
      const tools = (conn.related_tools ?? []).filter((t) => result.suggested_tools.includes(t));
      tools.forEach((t) => linkedTools.add(t));
      map.push({
        connector: conn,
        connDef: connectorDefinitions.find((c) => c.name === conn.name),
        tools,
      });
    }

    // Unlinked tools
    const unlinked = result.suggested_tools.filter((t) => !linkedTools.has(t));
    if (unlinked.length > 0) {
      map.push({ connector: { name: 'general' } as SuggestedConnector, connDef: undefined, tools: unlinked });
    }

    return map;
  }, [suggestedConnectors, connectorDefinitions, result.suggested_tools]);

  if (connectorToolMap.length === 0 && result.suggested_tools.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Plug className="w-4 h-4 text-emerald-400" />
        Connectors & Tools
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {connectorToolMap.map((item, idx) => {
          const isGeneral = item.connector.name === 'general';
          const installed = !isGeneral && connectorNames.has(item.connector.name);
          const hasCredential = !isGeneral && credentialTypes.has(item.connector.name);

          return (
            <div key={idx} className="bg-secondary/30 border border-primary/10 rounded-xl p-3.5 space-y-3">
              {/* Connector header */}
              <div className="flex items-center gap-2.5">
                {item.connDef?.icon_url ? (
                  <img src={item.connDef.icon_url} alt={item.connDef.label} className="w-6 h-6 flex-shrink-0 rounded" />
                ) : isGeneral ? (
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                    <Wrench className="w-3.5 h-3.5 text-muted-foreground/50" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                    <Plug className="w-3.5 h-3.5 text-muted-foreground/50" />
                  </div>
                )}
                <span className="text-sm font-medium text-foreground/80 flex-1 truncate">
                  {item.connDef?.label || (isGeneral ? 'General Tools' : item.connector.name)}
                </span>
                {!isGeneral && (
                  installed && hasCredential ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400/80 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400/80 flex-shrink-0" />
                  )
                )}
              </div>

              {/* Credential setup */}
              {!isGeneral && onConnectorClick && (item.connector.credential_fields?.length || item.connDef?.fields?.length) && (
                <button
                  type="button"
                  onClick={() => onConnectorClick(item.connector)}
                  className="flex items-center gap-1.5 text-xs text-primary/60 hover:text-primary transition-colors"
                >
                  {installed && hasCredential ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-amber-400" />
                  )}
                  <span>{installed && hasCredential ? 'Credential ready' : 'Configure credential'}</span>
                  {item.connector.setup_url && <ExternalLink className="w-3 h-3" />}
                </button>
              )}

              {/* Tools */}
              {item.tools.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-primary/[0.08]">
                  {item.tools.map((toolName) => {
                    const toolDef = allToolDefs.find((t) => t.name === toolName);
                    const isAlreadyAssigned = currentToolNames.includes(toolName);
                    const isSelected = selectedTools.has(toolName);

                    return (
                      <div key={toolName} className="flex items-center gap-2">
                        {!readOnly && (
                          <DesignCheckbox
                            checked={isSelected || isAlreadyAssigned}
                            disabled={isAlreadyAssigned}
                            onChange={() => onToolToggle(toolName)}
                          />
                        )}
                        <Wrench className="w-3 h-3 text-primary/40 flex-shrink-0" />
                        <span className="text-xs text-foreground/70 truncate">
                          {toolDef?.name || toolName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// EventsSection — Triggers + Event Subscriptions (activation mechanisms)
// ============================================================================

function EventsSection({
  result,
  selectedTriggerIndices,
  onTriggerToggle,
  suggestedSubscriptions,
  selectedSubscriptionIndices,
  onSubscriptionToggle,
  readOnly,
  actualTriggers,
  onTriggerEnabledToggle,
}: {
  result: DesignAnalysisResult;
  selectedTriggerIndices: Set<number>;
  onTriggerToggle: (index: number) => void;
  suggestedSubscriptions?: Array<{ event_type: string; source_filter?: object; description: string }>;
  selectedSubscriptionIndices: Set<number>;
  onSubscriptionToggle?: (idx: number) => void;
  readOnly: boolean;
  actualTriggers: DbPersonaTrigger[];
  onTriggerEnabledToggle?: (triggerId: string, enabled: boolean) => void;
}) {
  const hasTriggers = result.suggested_triggers.length > 0 || (readOnly && actualTriggers.length > 0);
  const hasSubscriptions = suggestedSubscriptions && suggestedSubscriptions.length > 0;

  if (!hasTriggers && !hasSubscriptions) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Zap className="w-4 h-4 text-amber-400" />
        Events & Triggers
        <span className="text-[10px] font-normal text-muted-foreground/30 ml-1">What activates this persona</span>
      </div>

      <div className="bg-secondary/20 border border-primary/10 rounded-xl overflow-hidden divide-y divide-primary/[0.06]">
        {/* Triggers */}
        {hasTriggers && (
          <div className="p-3.5 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40">Triggers</span>
            {readOnly && actualTriggers.length > 0 ? (
              actualTriggers.map((trigger) => {
                const config = parseTriggerConfig(trigger.config);
                return (
                  <div key={trigger.id} className="flex items-center gap-2.5 py-1">
                    <div className="flex-shrink-0">{triggerIcon(trigger.trigger_type as SuggestedTrigger['trigger_type'])}</div>
                    <span className={`text-sm capitalize truncate flex-1 ${trigger.enabled ? 'text-foreground/70' : 'text-muted-foreground/40'}`}>
                      {trigger.trigger_type}
                      {config.interval_seconds ? ` (${config.interval_seconds}s)` : ''}
                    </span>
                    {onTriggerEnabledToggle && (
                      <button
                        onClick={() => onTriggerEnabledToggle(trigger.id, !trigger.enabled)}
                        className="flex-shrink-0 p-0.5 rounded transition-colors hover:bg-secondary/50"
                        title={trigger.enabled ? 'Disable' : 'Enable'}
                      >
                        {trigger.enabled ? (
                          <ToggleRight className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-muted-foreground/30" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              result.suggested_triggers.map((trigger, trigIdx) => {
                const isSelected = selectedTriggerIndices.has(trigIdx);
                return (
                  <div key={trigIdx} className="flex items-start gap-2.5 py-1">
                    {!readOnly && (
                      <div className="mt-0.5">
                        <DesignCheckbox
                          checked={isSelected}
                          onChange={() => onTriggerToggle(trigIdx)}
                        />
                      </div>
                    )}
                    <div className="flex-shrink-0 mt-0.5">{triggerIcon(trigger.trigger_type)}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground/70 capitalize block">{trigger.trigger_type}</span>
                      <span className="text-xs text-muted-foreground/40 leading-snug block">{trigger.description}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Event Subscriptions */}
        {hasSubscriptions && (
          <div className="p-3.5 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-purple-400" />
              Event Subscriptions
            </span>
            {suggestedSubscriptions!.map((sub, subIdx) => {
              const isSelected = selectedSubscriptionIndices.has(subIdx);
              return (
                <div key={`sub-${subIdx}`} className="flex items-start gap-2.5 py-1">
                  {!readOnly && (
                    <div className="mt-0.5">
                      <DesignCheckbox
                        checked={!!isSelected}
                        onChange={() => onSubscriptionToggle?.(subIdx)}
                        color="purple"
                      />
                    </div>
                  )}
                  <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground/70 block">{sub.event_type}</span>
                    <span className="text-xs text-muted-foreground/40 leading-snug block">{sub.description}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MessagesSection — Notification channels (persona output)
// ============================================================================

function MessagesSection({
  channels,
  selectedChannelIndices,
  onChannelToggle,
  readOnly,
}: {
  channels: Array<{ type: string; description: string; required_connector: string; config_hints: Record<string, string> }>;
  selectedChannelIndices: Set<number>;
  onChannelToggle?: (index: number) => void;
  readOnly: boolean;
}) {
  if (channels.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Bell className="w-4 h-4 text-blue-400" />
        Messages & Notifications
        <span className="text-[10px] font-normal text-muted-foreground/30 ml-1">How this persona communicates</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {channels.map((channel, chIdx) => {
          const isSelected = selectedChannelIndices.has(chIdx);
          return (
            <div key={`ch-${chIdx}`} className="bg-secondary/20 border border-primary/10 rounded-xl p-3.5">
              <div className="flex items-start gap-3">
                {!readOnly && (
                  <div className="mt-0.5">
                    <DesignCheckbox
                      checked={isSelected}
                      onChange={() => onChannelToggle?.(chIdx)}
                      color="blue"
                    />
                  </div>
                )}
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  {channelIcon(channel.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground/80 capitalize block">{channel.type}</span>
                  <span className="text-xs text-muted-foreground/40 leading-snug block mt-0.5">{channel.description}</span>
                  {channel.required_connector && (
                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 text-[10px] rounded-full bg-primary/8 text-muted-foreground/50 border border-primary/10">
                      <Plug className="w-2.5 h-2.5" />
                      Requires {channel.required_connector}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

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
  const suggestedChannels = result.suggested_notification_channels ?? [];

  return (
    <div className="space-y-5">
      {/* Prompt Tabs */}
      <PromptTabsPreview result={result} />

      {/* Connectors & Tools */}
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

      {/* Events & Triggers */}
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

      {/* Messages & Notifications */}
      <MessagesSection
        channels={suggestedChannels}
        selectedChannelIndices={selectedChannelIndices}
        onChannelToggle={onChannelToggle}
        readOnly={readOnly}
      />

      {/* Feasibility */}
      {feasibility && (
        <DesignTestResults result={feasibility} />
      )}
    </div>
  );
}

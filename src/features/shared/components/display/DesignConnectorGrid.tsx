import { useMemo } from 'react';
import {
  Play,
  Clock,
  Wrench,
  Webhook,
  Zap,
  Plug,
  Bell,
  Hash,
  Send,
  Mail,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { AgentIR, SuggestedTrigger, SuggestedConnector } from '@/lib/types/designTypes';

// ============================================================================
// Helpers
// ============================================================================

function triggerIcon(type: SuggestedTrigger['trigger_type']) {
  switch (type) {
    case 'schedule':
    case 'polling':
      return <Clock className="w-4 h-4 text-amber-400" />;
    case 'webhook':
      return <Webhook className="w-4 h-4 text-blue-400" />;
    case 'manual':
      return <Play className="w-4 h-4 text-emerald-400" />;
    default:
      return <Zap className="w-4 h-4 text-purple-400" />;
  }
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

const SECTION_LABEL = 'typo-heading uppercase tracking-wider text-muted-foreground/90 flex items-center gap-2';

// ============================================================================
// Section 1: Connectors & Tools
// ============================================================================

function ConnectorsToolsSection({ designResult }: { designResult: AgentIR }) {
  const suggestedConnectors = designResult.suggested_connectors ?? [];

  const connectorRows = useMemo(() => {
    const linkedTools = new Set<string>();
    const rows: Array<{ connector: SuggestedConnector | null; tools: string[] }> = [];

    for (const conn of suggestedConnectors) {
      const suggestedTools = designResult.suggested_tools ?? [];
      const tools = (conn.related_tools ?? []).filter((t) => suggestedTools.includes(t));
      tools.forEach((t) => linkedTools.add(t));
      rows.push({ connector: conn, tools });
    }

    const unlinked = (designResult.suggested_tools ?? []).filter((t) => !linkedTools.has(t));
    if (unlinked.length > 0) {
      rows.push({ connector: null, tools: unlinked });
    }

    return rows;
  }, [suggestedConnectors, designResult.suggested_tools]);

  if (connectorRows.length === 0 && (designResult.suggested_tools ?? []).length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Plug className="w-4 h-4 text-emerald-400" />
        Connectors & Tools
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {connectorRows.map((row, idx) => {
          const isGeneral = !row.connector;
          const connectorName = row.connector?.name ?? 'general';
          const meta = getConnectorMeta(connectorName);

          return (
            <div key={idx} className="bg-secondary/30 border border-primary/10 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center gap-2.5">
                {row.connector ? (
                  <div
                    className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${meta.color}20` }}
                  >
                    <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Wrench className="w-3.5 h-3.5 text-muted-foreground/90" />
                  </div>
                )}
                <span className="typo-heading text-foreground/80 truncate flex-1">
                  {isGeneral ? 'General Tools' : meta.label}
                </span>
              </div>
              {row.tools.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-primary/[0.08]">
                  {row.tools.map((toolName) => (
                    <div key={toolName} className="flex items-center gap-2">
                      <Wrench className="w-3 h-3 text-primary/40 flex-shrink-0" />
                      <span className="typo-body text-foreground/90 truncate">{toolName}</span>
                    </div>
                  ))}
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
// Section 2: Events & Triggers
// ============================================================================

function EventsTriggersSection({ designResult }: { designResult: AgentIR }) {
  const triggers = designResult.suggested_triggers ?? [];
  const subscriptions = designResult.suggested_event_subscriptions ?? [];

  if (triggers.length === 0 && subscriptions.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Zap className="w-4 h-4 text-amber-400" />
        Events & Triggers
        <span className="typo-body text-muted-foreground/80 ml-1">What activates this persona</span>
      </div>

      <div className="bg-secondary/20 border border-primary/10 rounded-xl overflow-hidden divide-y divide-primary/[0.06]">
        {triggers.length > 0 && (
          <div className="p-3.5 space-y-2">
            <span className="typo-code uppercase tracking-wider text-muted-foreground/80">Triggers</span>
            {triggers.map((trigger, idx) => (
              <div key={idx} className="flex items-start gap-2.5 py-1">
                <div className="flex-shrink-0 mt-0.5">{triggerIcon(trigger.trigger_type)}</div>
                <div className="flex-1 min-w-0">
                  <span className="typo-body text-foreground/90 capitalize block">{trigger.trigger_type}</span>
                  <span className="typo-body text-muted-foreground/80 leading-snug block">{trigger.description}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {subscriptions.length > 0 && (
          <div className="p-3.5 space-y-2">
            <span className="typo-code uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-purple-400" />
              Event Subscriptions
            </span>
            {subscriptions.map((sub, idx) => (
              <div key={idx} className="flex items-start gap-2.5 py-1">
                <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="typo-body text-foreground/90 block">{sub.event_type}</span>
                  <span className="typo-body text-muted-foreground/80 leading-snug block">{sub.description}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Section 3: Messages & Notifications
// ============================================================================

function MessagesNotificationsSection({ designResult }: { designResult: AgentIR }) {
  const channels = Array.isArray(designResult.suggested_notification_channels) ? designResult.suggested_notification_channels : [];

  if (channels.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Bell className="w-4 h-4 text-blue-400" />
        Messages & Notifications
        <span className="typo-body text-muted-foreground/80 ml-1">How this persona communicates</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {channels.map((channel, idx) => (
          <div key={idx} className="bg-secondary/20 border border-primary/10 rounded-xl p-3.5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                {channelIcon(channel.type)}
              </div>
              <div className="flex-1 min-w-0">
                <span className="typo-heading text-foreground/80 capitalize block">{channel.type}</span>
                <span className="typo-body text-muted-foreground/80 leading-snug block mt-0.5">{channel.description}</span>
                {channel.required_connector && (
                  <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 typo-body rounded-full bg-primary/8 text-muted-foreground/90 border border-primary/10">
                    <Plug className="w-2.5 h-2.5" />
                    Requires {channel.required_connector}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component -- read-only display of connectors, triggers, and channels
// ============================================================================

export function DesignConnectorGrid({
  designResult,
  hideConnectorsTools = false,
}: {
  designResult: AgentIR;
  hideConnectorsTools?: boolean;
}) {
  return (
    <div className="space-y-6">
      {!hideConnectorsTools && <ConnectorsToolsSection designResult={designResult} />}
      <EventsTriggersSection designResult={designResult} />
      <MessagesNotificationsSection designResult={designResult} />
    </div>
  );
}

import { Link, Bell, Radio } from 'lucide-react';
import { SelectionCheckbox } from './SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { AgentIR } from '@/lib/types/designTypes';
import { MOTION } from '@/features/templates/animationPresets';

// ---------------------------------------------------------------------------
// Connectors Section
// ---------------------------------------------------------------------------

export function ConnectorsSection({
  connectors,
  selectedConnectorNames,
  onToggleConnector,
}: {
  connectors: NonNullable<AgentIR['suggested_connectors']>;
  selectedConnectorNames: Set<string>;
  onToggleConnector: (name: string) => void;
}) {
  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Link className="w-3 h-3" />
        Connectors ({connectors.length})
      </h4>
      <div className="flex flex-wrap gap-2">
        {connectors.map((conn) => {
          const isSelected = selectedConnectorNames.has(conn.name);
          const meta = getConnectorMeta(conn.name);
          return (
            <div
              key={conn.name}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all ${MOTION.snappy.css} cursor-pointer hover:opacity-80 ${
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
  );
}

// ---------------------------------------------------------------------------
// Channels Section
// ---------------------------------------------------------------------------

export function ChannelsSection({
  channels,
  selectedChannelIndices,
  onToggleChannel,
}: {
  channels: NonNullable<AgentIR['suggested_notification_channels']>;
  selectedChannelIndices: Set<number>;
  onToggleChannel: (index: number) => void;
}) {
  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Bell className="w-3 h-3" />
        Channels ({channels.length})
      </h4>
      <div className="space-y-2">
        {channels.map((channel, i) => {
          const isSelected = selectedChannelIndices.has(i);
          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${MOTION.snappy.css} cursor-pointer hover:opacity-80 ${
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
  );
}

// ---------------------------------------------------------------------------
// Events Section
// ---------------------------------------------------------------------------

export function EventsSection({
  events,
  selectedEventIndices,
  onToggleEvent,
}: {
  events: NonNullable<AgentIR['suggested_event_subscriptions']>;
  selectedEventIndices: Set<number>;
  onToggleEvent: (index: number) => void;
}) {
  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Radio className="w-3 h-3" />
        Events ({events.length})
      </h4>
      <div className="space-y-2">
        {events.map((event, i) => {
          const isSelected = selectedEventIndices.has(i);
          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${MOTION.snappy.css} cursor-pointer hover:opacity-80 ${
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
  );
}

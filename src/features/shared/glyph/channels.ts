import {
  MessageSquare, Mail, Bell, Send, Phone, Hash, Webhook, Monitor,
} from 'lucide-react';
import type { ParsedChannel } from './types';

type ChannelIconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

interface ChannelStyle {
  icon: ChannelIconComponent;
  tint: string;
}

/** ONE map, not two.
 *
 *  The icon and the tint are two halves of a single presentation rule keyed by
 *  the same channel vocabulary. Held as two parallel `Record<string, …>` maps
 *  they were a silent-drift pair: adding a channel to one and forgetting the
 *  other produced a tile with the right icon and the generic blue, or the
 *  right colour and a generic bubble — a rendering nothing in the type system,
 *  the linter or the tests could notice, because each map is individually
 *  well-formed. Keyed together, a half-added channel does not compile. */
const CHANNEL_STYLES: Record<string, ChannelStyle> = {
  slack: { icon: Hash, tint: '#4a154b' },
  teams: { icon: Hash, tint: '#5059C9' },
  discord: { icon: Hash, tint: '#5865F2' },
  telegram: { icon: Send, tint: '#229ED9' },
  email: { icon: Mail, tint: '#60a5fa' },
  smtp: { icon: Mail, tint: '#60a5fa' },
  mail: { icon: Mail, tint: '#60a5fa' },
  gmail: { icon: Mail, tint: '#ea4335' },
  outlook: { icon: Mail, tint: '#0078d4' },
  sms: { icon: Phone, tint: '#22c55e' },
  webhook: { icon: Webhook, tint: '#64748b' },
  push: { icon: Bell, tint: '#a78bfa' },
  notification: { icon: Bell, tint: '#a78bfa' },
  notify: { icon: Bell, tint: '#a78bfa' },
  desktop: { icon: Monitor, tint: '#a78bfa' },
};

const FALLBACK_STYLE: ChannelStyle = { icon: MessageSquare, tint: '#60a5fa' };

/** Turn a concatenated messageSummary (`"slack: team · email: daily"`) back
 *  into structured channel descriptors, one per `{type, description}` pair. */
export function parseChannels(summary: string | undefined): ParsedChannel[] {
  if (!summary) return [];
  return summary.split(' · ').map((seg) => {
    const [t, ...rest] = seg.split(':');
    return { type: (t ?? '').trim(), description: rest.join(':').trim() };
  }).filter((ch) => ch.type.length > 0);
}

function channelStyle(type: string): ChannelStyle {
  return CHANNEL_STYLES[type.toLowerCase()] ?? FALLBACK_STYLE;
}

export function channelIcon(type: string): ChannelIconComponent {
  return channelStyle(type).icon;
}

export function channelTint(type: string): string {
  return channelStyle(type).tint;
}

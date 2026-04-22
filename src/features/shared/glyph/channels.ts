import {
  MessageSquare, Mail, Bell, Send, Phone, Hash, Webhook,
} from 'lucide-react';
import type { ParsedChannel } from './types';

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  slack: Hash, teams: Hash, discord: Hash,
  telegram: Send,
  email: Mail, smtp: Mail, mail: Mail, gmail: Mail, outlook: Mail,
  sms: Phone,
  webhook: Webhook,
  push: Bell, notification: Bell, notify: Bell,
};

const CHANNEL_TINTS: Record<string, string> = {
  slack: '#4a154b', teams: '#5059C9', discord: '#5865F2',
  telegram: '#229ED9',
  email: '#60a5fa', gmail: '#ea4335', outlook: '#0078d4', smtp: '#60a5fa', mail: '#60a5fa',
  sms: '#22c55e',
  webhook: '#64748b',
  push: '#a78bfa', notification: '#a78bfa', notify: '#a78bfa',
};

/** Turn a concatenated messageSummary (`"slack: team · email: daily"`) back
 *  into structured channel descriptors, one per `{type, description}` pair. */
export function parseChannels(summary: string | undefined): ParsedChannel[] {
  if (!summary) return [];
  return summary.split(' · ').map((seg) => {
    const [t, ...rest] = seg.split(':');
    return { type: (t ?? '').trim(), description: rest.join(':').trim() };
  }).filter((ch) => ch.type.length > 0);
}

export function channelIcon(type: string) {
  return CHANNEL_ICONS[type.toLowerCase()] ?? MessageSquare;
}

export function channelTint(type: string): string {
  return CHANNEL_TINTS[type.toLowerCase()] ?? '#60a5fa';
}

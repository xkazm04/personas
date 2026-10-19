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

/** Own-key membership, never `in`. The summary is prose, and `in` also walks
 *  the prototype: "Notify the constructor by email" made `constructor` a
 *  channel whose style was `Object` itself, so its icon was `undefined` and
 *  the tile threw while rendering. */
function isKnownChannel(type: string): boolean {
  return Object.hasOwn(CHANNEL_STYLES, type.toLowerCase());
}

/** Recognised channel keywords inside a free-text segment, in order of first
 *  appearance, de-duplicated (`"Slack and email daily"` -> slack, email). */
function knownChannelsIn(text: string): string[] {
  const found = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter(isKnownChannel);
  return Array.from(new Set(found));
}

/** Turn a concatenated messageSummary (`"slack: team · email: daily digest"`)
 *  back into structured channel descriptors, one per `{type, description}` pair.
 *
 *  The summary is prose, so a segment may not follow the `type: description`
 *  shape. A segment is only trusted as a pair when its type is a single word;
 *  otherwise the sentence is never promoted to a channel TYPE — recognised
 *  channel names inside it become channels (the sentence is their description),
 *  and a segment naming none becomes an `unstructured` entry with an empty type
 *  so the UI can render it as plain text instead of a fake channel. */
export function parseChannels(summary: string | undefined): ParsedChannel[] {
  if (!summary) return [];
  const out: ParsedChannel[] = [];
  for (const raw of summary.split(' · ')) {
    const seg = raw.trim();
    if (!seg) continue;
    const [t, ...rest] = seg.split(':');
    const type = (t ?? '').trim();
    if (rest.length > 0 && type.length > 0 && !/\s/.test(type)) {
      out.push({ type, description: rest.join(':').trim() });
    } else if (rest.length === 0 && isKnownChannel(type)) {
      out.push({ type, description: '' });
    } else {
      const known = knownChannelsIn(seg);
      if (known.length > 0) known.forEach((k) => out.push({ type: k, description: seg }));
      else out.push({ type: '', description: seg, unstructured: true });
    }
  }
  return out;
}

function channelStyle(type: string): ChannelStyle {
  return isKnownChannel(type) ? CHANNEL_STYLES[type.toLowerCase()]! : FALLBACK_STYLE;
}

export function channelIcon(type: string): ChannelIconComponent {
  return channelStyle(type).icon;
}

export function channelTint(type: string): string {
  return channelStyle(type).tint;
}

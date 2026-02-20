import { useState } from 'react';
import {
  Plug,
  Mail,
  Calendar,
  HardDrive,
  MessageSquare,
  Github,
  Globe,
  CheckSquare,
} from 'lucide-react';

export interface ConnectorMeta {
  label: string;
  color: string;
  iconUrl: string | null;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  gmail: { label: 'Gmail', color: '#EA4335', iconUrl: 'https://cdn.simpleicons.org/gmail/EA4335', Icon: Mail },
  google_calendar: { label: 'Google Calendar', color: '#4285F4', iconUrl: 'https://cdn.simpleicons.org/googlecalendar/4285F4', Icon: Calendar },
  google_drive: { label: 'Google Drive', color: '#0F9D58', iconUrl: 'https://cdn.simpleicons.org/googledrive/0F9D58', Icon: HardDrive },
  slack: { label: 'Slack', color: '#4A154B', iconUrl: 'https://cdn.simpleicons.org/slack/4A154B', Icon: MessageSquare },
  github: { label: 'GitHub', color: '#24292e', iconUrl: 'https://cdn.simpleicons.org/github/f0f0f0', Icon: Github },
  http: { label: 'HTTP / REST', color: '#3B82F6', iconUrl: null, Icon: Globe },
  telegram: { label: 'Telegram', color: '#26A5E4', iconUrl: 'https://cdn.simpleicons.org/telegram/26A5E4', Icon: MessageSquare },
  discord: { label: 'Discord', color: '#5865F2', iconUrl: 'https://cdn.simpleicons.org/discord/5865F2', Icon: MessageSquare },
  jira: { label: 'Jira', color: '#0052CC', iconUrl: 'https://cdn.simpleicons.org/jira/0052CC', Icon: Globe },
  notion: { label: 'Notion', color: '#FFFFFF', iconUrl: 'https://cdn.simpleicons.org/notion/f0f0f0', Icon: Globe },
  clickup: { label: 'ClickUp', color: '#7B68EE', iconUrl: 'https://cdn.simpleicons.org/clickup/7B68EE', Icon: CheckSquare },
};

export function getConnectorMeta(name: string): ConnectorMeta {
  if (CONNECTOR_META[name]) return CONNECTOR_META[name];
  const slug = name.toLowerCase().replace(/[_\s]/g, '');
  return { label: name, color: '#6B7280', iconUrl: `https://cdn.simpleicons.org/${slug}/9ca3af`, Icon: Plug };
}

export function ConnectorIcon({ meta, size = 'w-3.5 h-3.5' }: { meta: ConnectorMeta; size?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const FallbackIcon = meta.Icon;
  if (meta.iconUrl && !imgFailed) {
    return <img src={meta.iconUrl} alt={meta.label} className={size} onError={() => setImgFailed(true)} />;
  }
  return <FallbackIcon className={size} style={{ color: meta.color }} />;
}

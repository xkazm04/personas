import {
  Clock, Globe, Webhook, Radio, Clipboard, AppWindow,
  Layers, FileEdit,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Signal source templates supported by the Studio commit form.
// ---------------------------------------------------------------------------

export interface TriggerBlockTemplate {
  id: string;
  triggerType: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

export const TRIGGER_BLOCK_TEMPLATES: TriggerBlockTemplate[] = [
  { id: 'blk-schedule',   triggerType: 'schedule',       label: 'Schedule',          icon: Clock,     color: 'text-amber-400',   description: 'Cron or interval trigger' },
  { id: 'blk-polling',    triggerType: 'polling',        label: 'Polling',           icon: Globe,     color: 'text-teal-400',    description: 'HTTP endpoint change detection' },
  { id: 'blk-webhook',    triggerType: 'webhook',        label: 'Webhook',           icon: Webhook,   color: 'text-blue-400',    description: 'External webhook POST' },
  { id: 'blk-event',      triggerType: 'event_listener', label: 'Event Listener',    icon: Radio,     color: 'text-cyan-400',    description: 'Listen for published events' },
  { id: 'blk-file',       triggerType: 'file_watcher',   label: 'File Watcher',      icon: FileEdit,  color: 'text-cyan-400',    description: 'Monitor filesystem changes' },
  { id: 'blk-clipboard',  triggerType: 'clipboard',      label: 'Clipboard',         icon: Clipboard, color: 'text-pink-400',    description: 'Monitor clipboard content' },
  { id: 'blk-app-focus',  triggerType: 'app_focus',      label: 'App Focus',         icon: AppWindow, color: 'text-indigo-400',  description: 'Monitor foreground app changes' },
  { id: 'blk-composite',  triggerType: 'composite',      label: 'Composite',         icon: Layers,    color: 'text-rose-400',    description: 'Multi-condition trigger with time window' },
];

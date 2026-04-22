import { Calendar, Webhook, Mouse, Radio, Eye, Zap, Clock } from 'lucide-react';
import type { Translations } from '@/i18n/en';
import type { GlyphTrigger } from './types';
import { humanizeCron } from './cron';

const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  schedule: Calendar, webhook: Webhook, manual: Mouse, polling: Clock,
  event_listener: Radio, file_watcher: Eye, app_focus: Eye,
};

export function triggerIcon(type: string) {
  return TRIGGER_ICONS[type] ?? Zap;
}

export function prettyTriggerType(t: Translations, type: string): string {
  const c = t.templates.chronology;
  switch (type) {
    case 'schedule': return c.trigger_schedule;
    case 'webhook': return c.trigger_webhook;
    case 'manual': return c.trigger_manual;
    case 'polling': return c.trigger_polling;
    case 'event_listener': return c.trigger_event;
    case 'file_watcher': return c.trigger_file_watch;
    case 'app_focus': return c.trigger_app_focus;
    default: return type;
  }
}

export function triggerDetail(tr: GlyphTrigger): string {
  if (tr.trigger_type === 'schedule' && tr.config) {
    const cron = typeof tr.config.cron === 'string' ? tr.config.cron : '';
    if (cron) return humanizeCron(cron);
  }
  return tr.description ?? '';
}

import { Webhook, Radio, Eye, Zap, Clock, MousePointerClick, Activity } from 'lucide-react';
import type { Translations } from '@/i18n/en';
import type { GlyphTrigger } from './types';
import { humanizeCron } from './cron';

/**
 * Canonical mapping from trigger-type string → Lucide icon component.
 *
 * This is the single source of truth for trigger icons across the app
 * (template cards, persona matrix, dimension edit panel, glyph renderer).
 * If you need to render a trigger icon, import {@link triggerIcon} from here.
 *
 * Reconciled icon choices (Wave 5 consolidation):
 *  - schedule    → Clock              (was Calendar in glyph; Clock in 3 other copies)
 *  - polling     → Radio              (was Clock in glyph; Radio in 3 other copies)
 *  - manual      → MousePointerClick  (was Mouse in glyph; MousePointerClick elsewhere)
 *  - event       → Activity           (matrix/dimension copies)
 *  - event_listener → Activity        (glyph used Radio; unified with `event`)
 *  - webhook     → Webhook
 *  - file_watcher / app_focus → Eye
 */
export const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
  event_listener: Activity,
  file_watcher: Eye,
  app_focus: Eye,
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

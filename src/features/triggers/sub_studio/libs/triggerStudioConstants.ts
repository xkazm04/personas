import {
  Clock, Globe, Webhook, Radio, Clipboard, AppWindow,
  Layers, FileEdit,
  type LucideIcon,
} from 'lucide-react';
import type { Translations } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Signal source templates supported by the Studio commit form.
// ---------------------------------------------------------------------------

type TriggersKey = Extract<keyof Translations['triggers'], `type_${string}`>;
type StudioKey = Extract<keyof Translations['triggers']['studio'], `tpl_desc_${string}`>;

export interface TriggerBlockTemplate {
  id: string;
  triggerType: string;
  /** Key into `t.triggers` (existing `type_*` labels shared with the trigger forms). */
  labelKey: TriggersKey;
  /** Key into `t.triggers.studio` (`tpl_desc_*`). */
  descriptionKey: StudioKey;
  icon: LucideIcon;
  color: string;
}

export const TRIGGER_BLOCK_TEMPLATES: TriggerBlockTemplate[] = [
  { id: 'blk-schedule',   triggerType: 'schedule',       labelKey: 'type_schedule',          icon: Clock,     color: 'text-amber-400',   descriptionKey: 'tpl_desc_schedule' },
  { id: 'blk-polling',    triggerType: 'polling',        labelKey: 'type_polling',           icon: Globe,     color: 'text-teal-400',    descriptionKey: 'tpl_desc_polling' },
  { id: 'blk-webhook',    triggerType: 'webhook',        labelKey: 'type_webhook',           icon: Webhook,   color: 'text-blue-400',    descriptionKey: 'tpl_desc_webhook' },
  { id: 'blk-event',      triggerType: 'event_listener', labelKey: 'type_event_listener',    icon: Radio,     color: 'text-cyan-400',    descriptionKey: 'tpl_desc_event_listener' },
  { id: 'blk-file',       triggerType: 'file_watcher',   labelKey: 'type_file_watcher',      icon: FileEdit,  color: 'text-cyan-400',    descriptionKey: 'tpl_desc_file_watcher' },
  { id: 'blk-clipboard',  triggerType: 'clipboard',      labelKey: 'type_clipboard',         icon: Clipboard, color: 'text-pink-400',    descriptionKey: 'tpl_desc_clipboard' },
  { id: 'blk-app-focus',  triggerType: 'app_focus',      labelKey: 'type_app_focus',         icon: AppWindow, color: 'text-indigo-400',  descriptionKey: 'tpl_desc_app_focus' },
  { id: 'blk-composite',  triggerType: 'composite',      labelKey: 'type_composite',         icon: Layers,    color: 'text-rose-400',    descriptionKey: 'tpl_desc_composite' },
];

/** Resolve a template's localized label + description (rail, chips, tooltips, search). */
export function templateCopy(t: Translations, tpl: TriggerBlockTemplate): { label: string; description: string } {
  return { label: t.triggers[tpl.labelKey], description: t.triggers.studio[tpl.descriptionKey] };
}

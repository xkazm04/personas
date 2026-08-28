import {
  Webhook, Radio, Eye, Zap, Clock, MousePointerClick, Activity,
  Link, ClipboardPaste, Combine,
} from 'lucide-react';
import type { Translations } from '@/i18n/en';
import type { TriggerKind } from '@/lib/bindings/TriggerKind';
import type { GlyphTrigger } from './types';
import { humanizeCron } from './cron';

type TriggerIconComponent = React.ComponentType<{ className?: string }>;

/**
 * Canonical mapping from trigger-type string → Lucide icon component.
 *
 * This is the single source of truth for trigger icons across the app
 * (template cards, persona matrix, dimension edit panel, glyph renderer).
 * If you need to render a trigger icon, import {@link triggerIcon} from here.
 *
 * `satisfies Record<TriggerKind, …>` is the totality gate: `TriggerKind` is
 * the generated Rust binding that the SQL CHECK and the door validator also
 * derive from, so a kind added in Rust fails to compile here until it is
 * given an icon. Without it this map silently fell back to `Zap` for
 * `chain`, `clipboard` and `composite` — three storable kinds it never
 * listed. Same discipline as `TRIGGER_TYPE_META_BY_KIND`
 * (src/lib/utils/platform/triggerConstants.ts).
 *
 * Reconciled icon choices (Wave 5 consolidation):
 *  - schedule    → Clock              (was Calendar in glyph; Clock in 3 other copies)
 *  - polling     → Radio              (was Clock in glyph; Radio in 3 other copies)
 *  - manual      → MousePointerClick  (was Mouse in glyph; MousePointerClick elsewhere)
 *  - event_listener → Activity        (glyph used Radio; unified with the `event` alias)
 *  - webhook     → Webhook
 *  - file_watcher / app_focus → Eye
 *  - chain / clipboard / composite → Link / ClipboardPaste / Combine
 *    (matched to `TRIGGER_TYPE_META` so the two maps agree on the new kinds)
 */
const TRIGGER_ICONS_BY_KIND = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event_listener: Activity,
  file_watcher: Eye,
  app_focus: Eye,
  chain: Link,
  clipboard: ClipboardPaste,
  composite: Combine,
} satisfies Record<TriggerKind, TriggerIconComponent>;

/** Keyed by `string`, not `TriggerKind`: call sites pass a raw stored
 *  `trigger_type`, and the legacy `event` alias predates `event_listener`. */
export const TRIGGER_ICONS: Record<string, TriggerIconComponent> = {
  ...TRIGGER_ICONS_BY_KIND,
  event: Activity,
};

export function triggerIcon(type: string) {
  return TRIGGER_ICONS[type] ?? Zap;
}

/** Kinds whose label lives in `triggers.type_*` rather than in the glyph's
 *  own `templates.chronology.trigger_*` set. Both catalogs are complete in
 *  all 14 locales; returning the raw `trigger_type` instead would put a
 *  machine token on screen. */
const CHRONOLOGY_LABEL_FALLBACK = {
  chain: 'type_chain',
  clipboard: 'type_clipboard',
  composite: 'type_composite',
} as const satisfies Partial<Record<TriggerKind, keyof Translations['triggers']>>;

export function prettyTriggerType(t: Translations, type: string): string {
  const c = t.templates.chronology;
  switch (type) {
    case 'schedule': return c.trigger_schedule;
    case 'webhook': return c.trigger_webhook;
    case 'manual': return c.trigger_manual;
    case 'polling': return c.trigger_polling;
    case 'event':
    case 'event_listener': return c.trigger_event;
    case 'file_watcher': return c.trigger_file_watch;
    case 'app_focus': return c.trigger_app_focus;
    default: {
      const key = CHRONOLOGY_LABEL_FALLBACK[type as keyof typeof CHRONOLOGY_LABEL_FALLBACK];
      return key ? (t.triggers[key] as string) : type;
    }
  }
}

/** One-line detail under a trigger's type label. Takes `t` for the same
 *  reason `prettyTriggerType` does: the schedule branch produces localized
 *  prose via {@link humanizeCron}. The description branch is user-authored
 *  content and passes through untouched. */
export function triggerDetail(t: Translations, tr: GlyphTrigger): string {
  if (tr.trigger_type === 'schedule' && tr.config) {
    const cron = typeof tr.config.cron === 'string' ? tr.config.cron : '';
    if (cron) return humanizeCron(t, cron);
  }
  return tr.description ?? '';
}

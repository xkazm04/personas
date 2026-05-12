import type { CompositeCondition } from '@/lib/utils/platform/triggerConstants';
import type { CronPreview } from '@/api/pipeline/triggers';
import type { Translations } from '@/i18n/en';

export interface TriggerFormState {
  triggerType: string;
  scheduleMode: 'interval' | 'cron';
  interval: string;
  cronExpression: string;
  cronPreview: CronPreview | null;
  /** IANA zone for the cron expression (e.g. "America/New_York"). Undefined =
   *  backend falls back to system-local. Only consulted for schedule triggers. */
  scheduleTimezone?: string;
  /** Catch-up cap when the trigger fires past several scheduled slots during
   *  downtime. Undefined or 1 = current fire-once-on-overdue behavior; the
   *  scheduler hard-caps at 100 regardless. */
  scheduleMaxBackfill?: number;
  endpoint: string;
  selectedEventId: string;
  hmacSecret: string;
  listenEventType: string;
  sourceFilter: string;
  watchPaths: string[];
  watchEvents: string[];
  watchRecursive: boolean;
  globFilter: string;
  clipboardContentType: string;
  clipboardPattern: string;
  clipboardInterval: string;
  appNames: string[];
  titlePattern: string;
  appFocusInterval: string;
  compositeConditions: CompositeCondition[];
  compositeOperator: string;
  windowSeconds: string;
}

export type BuildResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string };

export function buildTriggerConfig(s: TriggerFormState, t: Translations): BuildResult {
  const config: Record<string, unknown> = {};
  const v = t.triggers.build_validation;

  if (s.triggerType === 'schedule') {
    if (s.scheduleMode === 'cron') {
      if (!s.cronExpression.trim()) return { ok: false, error: v.cron_required };
      if (s.cronPreview && !s.cronPreview.valid) return { ok: false, error: s.cronPreview.error || v.cron_invalid };
      config.cron = s.cronExpression.trim();
    } else {
      const parsed = parseInt(s.interval);
      if (isNaN(parsed) || parsed < 60) return { ok: false, error: v.interval_minimum };
      config.interval_seconds = parsed;
    }
    // Persist timezone for cron-mode schedules so the backend evaluates the
    // expression in the user's intended zone instead of falling back to the
    // host's system-local time (the C5-handoff-2026-04-26 incident path).
    if (s.scheduleMode === 'cron' && s.scheduleTimezone) {
      config.timezone = s.scheduleTimezone;
    }
    // Persist max_backfill when the user opted in to catch-up. Default omitted
    // so existing fire-once-on-overdue behavior is preserved by absence.
    if (s.scheduleMaxBackfill !== undefined && s.scheduleMaxBackfill > 1) {
      config.max_backfill = Math.min(Math.floor(s.scheduleMaxBackfill), 100);
    }
  } else if (s.triggerType === 'polling') {
    const parsed = parseInt(s.interval);
    if (isNaN(parsed) || parsed < 60) return { ok: false, error: v.interval_minimum };
    config.interval_seconds = parsed;
    if (s.selectedEventId) { config.event_id = s.selectedEventId; } else { config.endpoint = s.endpoint; }
  } else if (s.triggerType === 'webhook') {
    config.webhook_secret = s.hmacSecret || generateWebhookSecret();
  } else if (s.triggerType === 'event_listener') {
    if (!s.listenEventType.trim()) return { ok: false, error: v.event_type_required };
    config.listen_event_type = s.listenEventType.trim();
    if (s.sourceFilter.trim()) config.source_filter = s.sourceFilter.trim();
  } else if (s.triggerType === 'file_watcher') {
    const paths = s.watchPaths.filter(p => p.trim());
    if (paths.length === 0) return { ok: false, error: v.watch_path_required };
    config.watch_paths = paths;
    config.events = s.watchEvents;
    config.recursive = s.watchRecursive;
    if (s.globFilter.trim()) config.glob_filter = s.globFilter.trim();
  } else if (s.triggerType === 'clipboard') {
    config.content_type = s.clipboardContentType;
    if (s.clipboardPattern.trim()) config.pattern = s.clipboardPattern.trim();
    const pi = parseInt(s.clipboardInterval);
    config.interval_seconds = isNaN(pi) || pi < 2 ? 5 : pi;
  } else if (s.triggerType === 'app_focus') {
    const names = s.appNames.filter(n => n.trim());
    if (names.length > 0) config.app_names = names;
    if (s.titlePattern.trim()) config.title_pattern = s.titlePattern.trim();
    const pi = parseInt(s.appFocusInterval);
    config.interval_seconds = isNaN(pi) || pi < 2 ? 3 : pi;
  } else if (s.triggerType === 'composite') {
    const validConditions = s.compositeConditions.filter(c => c.event_type.trim());
    if (validConditions.length < 2) return { ok: false, error: v.composite_min_conditions };
    const secs = parseInt(s.windowSeconds);
    if (isNaN(secs) || secs < 5) return { ok: false, error: v.composite_window_minimum };
    config.conditions = validConditions;
    config.operator = s.compositeOperator;
    config.window_seconds = secs;
  }

  return { ok: true, config };
}

/** Generate a 32-byte hex secret for webhook HMAC signing. */
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

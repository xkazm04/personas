import type { CompositeCondition } from '@/lib/utils/platform/triggerConstants';
import type { CronPreview } from '@/api/pipeline/triggers';

export interface TriggerFormState {
  triggerType: string;
  scheduleMode: 'interval' | 'cron';
  interval: string;
  cronExpression: string;
  cronPreview: CronPreview | null;
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

export function buildTriggerConfig(s: TriggerFormState): BuildResult {
  const config: Record<string, unknown> = {};

  if (s.triggerType === 'schedule') {
    if (s.scheduleMode === 'cron') {
      if (!s.cronExpression.trim()) return { ok: false, error: 'Cron expression is required.' };
      if (s.cronPreview && !s.cronPreview.valid) return { ok: false, error: s.cronPreview.error || 'Invalid cron expression.' };
      config.cron = s.cronExpression.trim();
    } else {
      const parsed = parseInt(s.interval);
      if (isNaN(parsed) || parsed < 60) return { ok: false, error: 'Interval must be at least 60 seconds.' };
      config.interval_seconds = parsed;
    }
  } else if (s.triggerType === 'polling') {
    const parsed = parseInt(s.interval);
    if (isNaN(parsed) || parsed < 60) return { ok: false, error: 'Interval must be at least 60 seconds.' };
    config.interval_seconds = parsed;
    if (s.selectedEventId) { config.event_id = s.selectedEventId; } else { config.endpoint = s.endpoint; }
  } else if (s.triggerType === 'webhook') {
    if (s.hmacSecret) config.webhook_secret = s.hmacSecret;
  } else if (s.triggerType === 'event_listener') {
    if (!s.listenEventType.trim()) return { ok: false, error: 'Event type to listen for is required.' };
    config.listen_event_type = s.listenEventType.trim();
    if (s.sourceFilter.trim()) config.source_filter = s.sourceFilter.trim();
  } else if (s.triggerType === 'file_watcher') {
    const paths = s.watchPaths.filter(p => p.trim());
    if (paths.length === 0) return { ok: false, error: 'At least one watch path is required.' };
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
    if (validConditions.length < 2) return { ok: false, error: 'Composite triggers need at least 2 conditions.' };
    const secs = parseInt(s.windowSeconds);
    if (isNaN(secs) || secs < 5) return { ok: false, error: 'Time window must be at least 5 seconds.' };
    config.conditions = validConditions;
    config.operator = s.compositeOperator;
    config.window_seconds = secs;
  }

  return { ok: true, config };
}

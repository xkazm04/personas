import { Clock, Webhook, Play, Zap, Link, RefreshCw, Radio, FolderSearch, ClipboardPaste, AppWindow, Combine } from 'lucide-react';

export interface TriggerTypeMeta {
  Icon: typeof Clock;
  color: string;
}

export const TRIGGER_TYPE_META: Record<string, TriggerTypeMeta> = {
  schedule: { Icon: Clock, color: 'text-amber-400' },
  polling: { Icon: RefreshCw, color: 'text-teal-400' },
  webhook: { Icon: Webhook, color: 'text-blue-400' },
  manual: { Icon: Play, color: 'text-emerald-400' },
  chain: { Icon: Link, color: 'text-purple-400' },
  event_listener: { Icon: Radio, color: 'text-cyan-400' },
  file_watcher: { Icon: FolderSearch, color: 'text-orange-400' },
  clipboard: { Icon: ClipboardPaste, color: 'text-pink-400' },
  app_focus: { Icon: AppWindow, color: 'text-indigo-400' },
  composite: { Icon: Combine, color: 'text-rose-400' },
};

export const DEFAULT_TRIGGER_META: TriggerTypeMeta = { Icon: Zap, color: 'text-purple-400' };

// -- Trigger category taxonomy ----------------------------------------
//
// The 10 trigger types decompose into 3 intuitive categories:
//  - Pull (Watch): poll on intervals (schedule, polling, clipboard, app_focus, file_watcher)
//  - Push (Listen): receive external events (webhook, event_listener)
//  - Compose (Combine): combine other triggers (chain, composite)
//  Manual is a degenerate case shown separately.

export type TriggerCategory = 'pull' | 'push' | 'compose' | 'manual';

export interface TriggerCategoryMeta {
  id: TriggerCategory;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  types: string[];
}

export const TRIGGER_CATEGORIES: TriggerCategoryMeta[] = [
  {
    id: 'pull',
    label: 'Watch',
    description: 'Poll for changes on an interval',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    types: ['schedule', 'polling', 'file_watcher', 'clipboard', 'app_focus'],
  },
  {
    id: 'push',
    label: 'Listen',
    description: 'Receive external signals',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    types: ['webhook', 'event_listener'],
  },
  {
    id: 'compose',
    label: 'Combine',
    description: 'Chain or compose triggers',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    types: ['chain', 'composite'],
  },
];

const _categoryByType = new Map<string, TriggerCategory>();
for (const cat of TRIGGER_CATEGORIES) {
  for (const t of cat.types) _categoryByType.set(t, cat.id);
}
_categoryByType.set('manual', 'manual');

/** Get the category for a trigger type. */
export function getTriggerCategory(triggerType: string): TriggerCategory {
  return _categoryByType.get(triggerType) ?? 'manual';
}

/** Get the category metadata for a trigger type. */
export function getTriggerCategoryMeta(triggerType: string): TriggerCategoryMeta | undefined {
  const catId = getTriggerCategory(triggerType);
  return TRIGGER_CATEGORIES.find((c) => c.id === catId);
}

/** Type option descriptor for the add form. */
export interface TriggerTypeOption {
  type: string;
  label: string;
  description: string;
}

export const TRIGGER_TYPE_OPTIONS: TriggerTypeOption[] = [
  { type: 'manual', label: 'Manual', description: 'Run on demand' },
  { type: 'schedule', label: 'Schedule', description: 'Run on a timer or cron' },
  { type: 'polling', label: 'Polling', description: 'Check an endpoint' },
  { type: 'webhook', label: 'Webhook', description: 'HTTP webhook listener' },
  { type: 'event_listener', label: 'Event Listener', description: 'React to internal events' },
  { type: 'file_watcher', label: 'File Watcher', description: 'React to file system changes' },
  { type: 'clipboard', label: 'Clipboard', description: 'React to clipboard changes' },
  { type: 'app_focus', label: 'App Focus', description: 'React to app focus changes' },
  { type: 'chain', label: 'Chain', description: 'Trigger after another agent completes' },
  { type: 'composite', label: 'Composite', description: 'Multiple conditions + time window' },
];

// -- Webhook URL configuration ----------------------------------------

/** Base URL for the webhook server. Override via VITE_WEBHOOK_BASE_URL env var for production. */
export const WEBHOOK_BASE_URL: string =
  (import.meta.env.VITE_WEBHOOK_BASE_URL as string | undefined) || 'http://localhost:9420';

/** Whether the webhook URL is pointing at the default localhost (dev mode). */
export const IS_WEBHOOK_LOCALHOST: boolean = WEBHOOK_BASE_URL.includes('localhost');

/** Build the full webhook URL for a given trigger ID. */
export function getWebhookUrl(triggerId: string): string {
  return `${WEBHOOK_BASE_URL}/webhook/${triggerId}`;
}

// -- Typed trigger config discriminated union ----------------------------

export interface ScheduleConfig {
  type: 'schedule';
  cron?: string;
  interval_seconds?: number;
  event_type?: string;
}

export interface PollingConfig {
  type: 'polling';
  url?: string;
  headers?: Record<string, string>;
  content_hash?: string;
  interval_seconds?: number;
  event_type?: string;
  /** Legacy field: credential event ID for linked polling */
  event_id?: string;
  /** Legacy field: endpoint URL (alias for url) */
  endpoint?: string;
}

export interface WebhookConfig {
  type: 'webhook';
  webhook_secret?: string;
  event_type?: string;
}

export interface ChainConfig {
  type: 'chain';
  source_persona_id?: string;
  condition?: { type: string; status?: string };
  event_type?: string;
}

export interface ManualConfig {
  type: 'manual';
  event_type?: string;
}

export interface EventListenerConfig {
  type: 'event_listener';
  listen_event_type?: string;
  source_filter?: string;
}

export interface FileWatcherConfig {
  type: 'file_watcher';
  watch_paths?: string[];
  events?: string[];
  recursive?: boolean;
  glob_filter?: string;
  event_type?: string;
}

export interface ClipboardConfig {
  type: 'clipboard';
  content_type?: string;
  pattern?: string;
  interval_seconds?: number;
  event_type?: string;
}

export interface AppFocusConfig {
  type: 'app_focus';
  app_names?: string[];
  title_pattern?: string;
  interval_seconds?: number;
  event_type?: string;
}

export interface CompositeCondition {
  event_type: string;
  source_filter?: string;
}

export interface CompositeConfig {
  type: 'composite';
  conditions?: CompositeCondition[];
  operator?: string;
  window_seconds?: number;
  event_type?: string;
}

export type TriggerConfig =
  | ScheduleConfig
  | PollingConfig
  | WebhookConfig
  | ChainConfig
  | ManualConfig
  | EventListenerConfig
  | FileWatcherConfig
  | ClipboardConfig
  | AppFocusConfig
  | CompositeConfig;

// -- Rate Limit Configuration -----------------------------------------

export interface TriggerRateLimitConfig {
  /** Max executions allowed per window. 0 = unlimited. */
  max_per_window: number;
  /** Window size in seconds (60 = per minute, 3600 = per hour). */
  window_seconds: number;
  /** Minimum cooldown between consecutive firings (seconds). 0 = no cooldown. */
  cooldown_seconds: number;
  /** Max concurrent executions. 0 = unlimited. */
  max_concurrent: number;
}

export const DEFAULT_RATE_LIMIT: TriggerRateLimitConfig = {
  max_per_window: 0,
  window_seconds: 60,
  cooldown_seconds: 0,
  max_concurrent: 0,
};

export const RATE_LIMIT_WINDOW_OPTIONS = [
  { label: 'Per minute', value: 60 },
  { label: 'Per 5 minutes', value: 300 },
  { label: 'Per hour', value: 3600 },
] as const;

/** Extract rate_limit from a raw config object, falling back to defaults. */
export function extractRateLimit(config: Record<string, unknown> | null | undefined): TriggerRateLimitConfig {
  if (!config || typeof config.rate_limit !== 'object' || config.rate_limit === null) {
    return { ...DEFAULT_RATE_LIMIT };
  }
  const rl = config.rate_limit as Record<string, unknown>;
  return {
    max_per_window: typeof rl.max_per_window === 'number' ? rl.max_per_window : 0,
    window_seconds: typeof rl.window_seconds === 'number' ? rl.window_seconds : 60,
    cooldown_seconds: typeof rl.cooldown_seconds === 'number' ? rl.cooldown_seconds : 0,
    max_concurrent: typeof rl.max_concurrent === 'number' ? rl.max_concurrent : 0,
  };
}

/** Check if a rate limit config has any active limits. */
export function hasActiveRateLimit(rl: TriggerRateLimitConfig): boolean {
  return rl.max_per_window > 0 || rl.cooldown_seconds > 0 || rl.max_concurrent > 0;
}

// -- Pre-built trigger templates --------------------------------------

export interface TriggerTemplate {
  id: string;
  label: string;
  description: string;
  triggerType: string;
  config: Record<string, unknown>;
}

export const TRIGGER_TEMPLATES: TriggerTemplate[] = [
  // File watcher templates
  {
    id: 'fw-error-logs',
    label: 'Auto-analyze error logs',
    description: 'Triggers when new .log files appear or change in a folder',
    triggerType: 'file_watcher',
    config: {
      watch_paths: [''],
      events: ['create', 'modify'],
      recursive: true,
      glob_filter: '*.log',
    },
  },
  {
    id: 'fw-csv-data',
    label: 'Process new CSV files',
    description: 'Triggers when CSV files are added or modified',
    triggerType: 'file_watcher',
    config: {
      watch_paths: [''],
      events: ['create', 'modify'],
      recursive: false,
      glob_filter: '*.csv',
    },
  },
  {
    id: 'fw-config-changes',
    label: 'Watch config file changes',
    description: 'Triggers on changes to JSON, YAML, or TOML config files',
    triggerType: 'file_watcher',
    config: {
      watch_paths: [''],
      events: ['modify'],
      recursive: true,
      glob_filter: '*.{json,yaml,yml,toml}',
    },
  },
  // Clipboard templates
  {
    id: 'cb-url-summarize',
    label: 'Auto-summarize copied URLs',
    description: 'Triggers when you copy a URL to your clipboard',
    triggerType: 'clipboard',
    config: {
      content_type: 'text',
      pattern: 'https?://\\S+',
      interval_seconds: 3,
    },
  },
  {
    id: 'cb-error-message',
    label: 'Auto-diagnose error messages',
    description: 'Triggers when you copy text containing errors or exceptions',
    triggerType: 'clipboard',
    config: {
      content_type: 'text',
      pattern: '(?i)(error|exception|traceback|panic|fatal|FAIL)',
      interval_seconds: 3,
    },
  },
  {
    id: 'cb-code-snippet',
    label: 'Auto-format code snippets',
    description: 'Triggers when you copy code-like text (function definitions, imports)',
    triggerType: 'clipboard',
    config: {
      content_type: 'text',
      pattern: '(function |def |class |import |const |let |var |=>|\\{\\s*$)',
      interval_seconds: 3,
    },
  },
];

/**
 * Parse a trigger's raw config JSON into a typed discriminated union.
 *
 * The discriminant comes from `triggerType` (the `trigger_type` column), not
 * from the JSON itself, mirroring the Rust `PersonaTrigger::parse_config()`.
 */
export function parseTriggerConfig(
  triggerType: string,
  config: string | object | null | undefined,
): TriggerConfig {
  const raw = parseRawConfig(config);

  // Warn when the config's own type field disagrees with the trigger_type column
  if (typeof raw.type === 'string' && raw.type !== triggerType) {
    console.warn(
      `[trigger] config.type "${raw.type}" does not match trigger_type "${triggerType}". ` +
      `Using trigger_type as discriminant. This may indicate a migration bug or manual DB edit.`,
    );
  }

  switch (triggerType) {
    case 'schedule':
      return {
        type: 'schedule',
        cron: raw.cron as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'polling':
      return {
        type: 'polling',
        url: raw.url as string | undefined,
        headers: raw.headers as Record<string, string> | undefined,
        content_hash: raw.content_hash as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
        event_id: raw.event_id as string | undefined,
        endpoint: raw.endpoint as string | undefined,
      };
    case 'webhook':
      return {
        type: 'webhook',
        webhook_secret: raw.webhook_secret as string | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'chain':
      return {
        type: 'chain',
        source_persona_id: raw.source_persona_id as string | undefined,
        condition: raw.condition as { type: string; status?: string } | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'event_listener':
      return {
        type: 'event_listener',
        listen_event_type: raw.listen_event_type as string | undefined,
        source_filter: raw.source_filter as string | undefined,
      };
    case 'file_watcher':
      return {
        type: 'file_watcher',
        watch_paths: raw.watch_paths as string[] | undefined,
        events: raw.events as string[] | undefined,
        recursive: raw.recursive as boolean | undefined,
        glob_filter: raw.glob_filter as string | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'clipboard':
      return {
        type: 'clipboard',
        content_type: raw.content_type as string | undefined,
        pattern: raw.pattern as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'app_focus':
      return {
        type: 'app_focus',
        app_names: raw.app_names as string[] | undefined,
        title_pattern: raw.title_pattern as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'composite':
      return {
        type: 'composite',
        conditions: raw.conditions as CompositeCondition[] | undefined,
        operator: raw.operator as string | undefined,
        window_seconds: raw.window_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'manual':
      return {
        type: 'manual',
        event_type: raw.event_type as string | undefined,
      };
    default:
      return { type: 'manual', event_type: raw.event_type as string | undefined };
  }
}

/** Internal: parse raw JSON/object/string into a plain object. */
function parseRawConfig(config: string | object | null | undefined): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === 'object') return config as Record<string, unknown>;
  try {
    return JSON.parse(config);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return {};
  }
}

import { Clock, Webhook, Play, Zap, Link, RefreshCw, Radio, FolderSearch, ClipboardPaste, AppWindow, Combine } from 'lucide-react';
import { createLogger } from "@/lib/log";
import { en, type Translations } from '@/i18n/en';
import type { Schedule } from '@/lib/types/schedule';
import type { TriggerKind } from '@/lib/bindings/TriggerKind';

const logger = createLogger("trigger-constants");

/**
 * The trigger-type vocabulary, re-exported from the generated Rust binding.
 *
 * `TriggerKind` is the ONE declaration — the SQL `CHECK`, the Rust door
 * validator and this menu all derive from it. Everything in this file that
 * enumerates trigger types is keyed `Record<TriggerKind, …>` so the menu is
 * **total**: a kind added in Rust fails to compile here until it is given a
 * label, an icon and a config panel, and a kind the store cannot accept cannot
 * be typed at all. That is the property whose absence let the form offer four
 * types no install has ever been able to save.
 */
export type { TriggerKind };

/** Every storable trigger type, in menu order. Derived from `TriggerKind`. */
export const TRIGGER_KINDS = [
  'manual',
  'schedule',
  'polling',
  'webhook',
  'event_listener',
  'file_watcher',
  'clipboard',
  'app_focus',
  'chain',
  'composite',
] as const satisfies readonly TriggerKind[];

/** Narrow an arbitrary string (a stored `trigger_type`) to the vocabulary. */
export function asTriggerKind(raw: string): TriggerKind | null {
  return (TRIGGER_KINDS as readonly string[]).includes(raw) ? (raw as TriggerKind) : null;
}

export interface TriggerTypeMeta {
  Icon: typeof Clock;
  color: string;
}

/**
 * `satisfies Record<TriggerKind, …>` is the totality gate: a kind added in Rust
 * fails to compile here until it has an icon, and a key outside the vocabulary
 * is rejected as an excess property. The exported binding stays
 * `Record<string, …>` because call sites index it with a raw stored
 * `trigger_type`.
 */
const TRIGGER_TYPE_META_BY_KIND = {
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
} satisfies Record<TriggerKind, TriggerTypeMeta>;

export const TRIGGER_TYPE_META: Record<string, TriggerTypeMeta> = TRIGGER_TYPE_META_BY_KIND;

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
  /** Members of this category. Typed to the vocabulary so a category cannot
   *  advertise a type the store will reject. */
  types: TriggerKind[];
}

/**
 * Category membership — the ONE declaration of which kind belongs where.
 *
 * `as const` so the union of members is computable at the type level, and
 * `satisfies Record<TriggerCategory, readonly TriggerKind[]>` so a category
 * cannot advertise a kind the store will reject. `TRIGGER_CATEGORIES` derives
 * its `types` from here, so the card list and the lookup map cannot drift.
 */
const CATEGORY_MEMBERS = {
  pull: ['schedule', 'polling', 'file_watcher', 'clipboard', 'app_focus'],
  push: ['webhook', 'event_listener'],
  compose: ['chain', 'composite'],
  /** Degenerate category — `manual` is shown separately and has no card. */
  manual: ['manual'],
} as const satisfies Record<TriggerCategory, readonly TriggerKind[]>;

/**
 * Totality gate for the taxonomy.
 *
 * The three `satisfies Record<TriggerKind, …>` maps above (icons, copy, i18n
 * keys) already fail to compile when Rust adds a kind. The taxonomy did NOT:
 * `TRIGGER_CATEGORIES` was a plain array, so an uncategorised kind fell through
 * `getTriggerCategory`'s `?? 'manual'` and a new push-style trigger would have
 * rendered under "Manual" with no error anywhere. This makes that a compile
 * failure naming the missing kind.
 */
type CategorisedKind = (typeof CATEGORY_MEMBERS)[TriggerCategory][number];
const _assertEveryTriggerKindIsCategorised: (kind: TriggerKind) => CategorisedKind = (kind) => kind;
void _assertEveryTriggerKindIsCategorised;

export const TRIGGER_CATEGORIES: TriggerCategoryMeta[] = [
  {
    id: 'pull',
    label: 'Watch',             // i18n: triggers.category_pull
    description: 'Poll for changes on an interval', // i18n: triggers.category_pull_desc
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    types: [...CATEGORY_MEMBERS.pull],
  },
  {
    id: 'push',
    label: 'Listen',            // i18n: triggers.category_push
    description: 'Receive external signals', // i18n: triggers.category_push_desc
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    types: [...CATEGORY_MEMBERS.push],
  },
  {
    id: 'compose',
    label: 'Combine',           // i18n: triggers.category_compose
    description: 'Chain or compose triggers', // i18n: triggers.category_compose_desc
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    types: [...CATEGORY_MEMBERS.compose],
  },
];

// Built from CATEGORY_MEMBERS rather than from TRIGGER_CATEGORIES so `manual`
// -- which deliberately has no card -- is covered by the same declaration the
// totality gate checks, instead of by a hand-written extra `set` call.
const _categoryByType = new Map<string, TriggerCategory>();
for (const [id, kinds] of Object.entries(CATEGORY_MEMBERS)) {
  for (const kind of kinds) _categoryByType.set(kind, id as TriggerCategory);
}

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
  type: TriggerKind;
  label: string;
  description: string;
}

/**
 * English fallback copy, one entry per kind. `satisfies Record<TriggerKind, …>`
 * makes it total: the menu below is generated from `TRIGGER_KINDS`, so it
 * cannot be short a member (which is how four unstorable types once sat in it
 * unnoticed) nor carry one the store rejects.
 */
const TRIGGER_TYPE_COPY = {
  manual: { label: 'Manual', description: 'Run on demand' },                              // i18n: triggers.type_manual / triggers.desc_manual
  schedule: { label: 'Schedule', description: 'Run on a timer or cron' },                  // i18n: triggers.type_schedule / triggers.desc_schedule
  polling: { label: 'Polling', description: 'Check an endpoint' },                        // i18n: triggers.type_polling / triggers.desc_polling
  webhook: { label: 'Webhook', description: 'HTTP webhook listener' },                    // i18n: triggers.type_webhook / triggers.desc_webhook
  event_listener: { label: 'Event Listener', description: 'React to internal events' },   // i18n: triggers.type_event_listener / triggers.desc_event_listener
  file_watcher: { label: 'File Watcher', description: 'React to file system changes' },   // i18n: triggers.type_file_watcher / triggers.desc_file_watcher
  clipboard: { label: 'Clipboard', description: 'React to clipboard changes' },           // i18n: triggers.type_clipboard / triggers.desc_clipboard
  app_focus: { label: 'App Focus', description: 'React to app focus changes' },           // i18n: triggers.type_app_focus / triggers.desc_app_focus
  chain: { label: 'Chain', description: 'Trigger after another agent completes' },        // i18n: triggers.type_chain / triggers.desc_chain
  composite: { label: 'Composite', description: 'Multiple conditions + time window' },    // i18n: triggers.type_composite / triggers.desc_composite
} satisfies Record<TriggerKind, { label: string; description: string }>;

/** The Add-trigger menu — **derived from the vocabulary**, in menu order. */
export const TRIGGER_TYPE_OPTIONS: TriggerTypeOption[] = TRIGGER_KINDS.map((type) => ({
  type,
  label: TRIGGER_TYPE_COPY[type].label,
  description: TRIGGER_TYPE_COPY[type].description,
}));

// -- i18n key helpers ---------------------------------------------------

/** Map trigger type to i18n key for label. Usage: t[triggerTypeI18nKey(type)] */
const TRIGGER_TYPE_I18N_BY_KIND = {
  manual:         { label: 'triggers.type_manual',         desc: 'triggers.desc_manual' },
  schedule:       { label: 'triggers.type_schedule',       desc: 'triggers.desc_schedule' },
  polling:        { label: 'triggers.type_polling',        desc: 'triggers.desc_polling' },
  webhook:        { label: 'triggers.type_webhook',        desc: 'triggers.desc_webhook' },
  event_listener: { label: 'triggers.type_event_listener', desc: 'triggers.desc_event_listener' },
  file_watcher:   { label: 'triggers.type_file_watcher',   desc: 'triggers.desc_file_watcher' },
  clipboard:      { label: 'triggers.type_clipboard',      desc: 'triggers.desc_clipboard' },
  app_focus:      { label: 'triggers.type_app_focus',      desc: 'triggers.desc_app_focus' },
  chain:          { label: 'triggers.type_chain',          desc: 'triggers.desc_chain' },
  composite:      { label: 'triggers.type_composite',      desc: 'triggers.desc_composite' },
} satisfies Record<TriggerKind, { label: string; desc: string }>;

export const TRIGGER_TYPE_I18N: Record<string, { label: string; desc: string }> =
  TRIGGER_TYPE_I18N_BY_KIND;

/**
 * Category id -> the keys inside the `triggers` section carrying its copy.
 *
 * `satisfies Record<Exclude<TriggerCategory, 'manual'>, ...>` makes it total
 * over the categories that actually render a card, so a fourth category cannot
 * be added without its copy. `manual` is excluded deliberately: it has no card.
 */
const CATEGORY_I18N_KEYS = {
  pull:    { label: 'category_pull',    desc: 'category_pull_desc' },
  push:    { label: 'category_push',    desc: 'category_push_desc' },
  compose: { label: 'category_compose', desc: 'category_compose_desc' },
} as const satisfies Record<
  Exclude<TriggerCategory, 'manual'>,
  { label: keyof Translations['triggers']; desc: keyof Translations['triggers'] }
>;

/**
 * Map trigger category ID to the fully-qualified i18n key for label/description.
 *
 * DERIVED from `CATEGORY_I18N_KEYS` rather than written out again. It used to be
 * a second hand-maintained copy of the same mapping, and `getTriggerCategories`
 * below kept a THIRD one locally -- so the exported table could drift from the
 * keys the UI actually reads with nothing to notice.
 */
export const TRIGGER_CATEGORY_I18N: Record<string, { label: string; desc: string }> =
  Object.fromEntries(
    Object.entries(CATEGORY_I18N_KEYS).map(([id, keys]) => [
      id,
      { label: `triggers.${keys.label}`, desc: `triggers.${keys.desc}` },
    ]),
  );

/** Resolve trigger type options with translated labels. Defaults to English. */
export function getTriggerTypeOptions(t: Translations = en): TriggerTypeOption[] {
  return TRIGGER_TYPE_OPTIONS.map((opt) => {
    const i18n = TRIGGER_TYPE_I18N[opt.type];
    if (!i18n) return opt;
    const labelKey = `type_${opt.type}` as keyof Translations['triggers'];
    const descKey = `desc_${opt.type}` as keyof Translations['triggers'];
    return {
      ...opt,
      label: (t.triggers[labelKey] as string) ?? opt.label,
      description: (t.triggers[descKey] as string) ?? opt.description,
    };
  });
}

/** Resolve trigger category metadata with translated labels. Defaults to English. */
export function getTriggerCategories(t: Translations = en): TriggerCategoryMeta[] {
  return TRIGGER_CATEGORIES.map((cat) => {
    const keys = (CATEGORY_I18N_KEYS as Record<
      string,
      { label: keyof Translations['triggers']; desc: keyof Translations['triggers'] } | undefined
    >)[cat.id];
    if (!keys) return cat;
    return {
      ...cat,
      label: (t.triggers[keys.label] as string) ?? cat.label,
      description: (t.triggers[keys.desc] as string) ?? cat.description,
    };
  });
}

/** Resolve rate-limit window options with translated labels. Defaults to English. */
export function getRateLimitWindowOptions(t: Translations = en): readonly { label: string; value: number }[] {
  const keyMap: Record<number, keyof Translations['triggers']> = {
    60:   'rate_per_minute',
    300:  'rate_per_5_minutes',
    3600: 'rate_per_hour',
  };
  return RATE_LIMIT_WINDOW_OPTIONS.map((opt) => {
    const key = keyMap[opt.value];
    return {
      ...opt,
      label: key ? ((t.triggers[key] as string) ?? opt.label) : opt.label,
    };
  });
}

/** Resolve trigger template labels with translations. Defaults to English. */
export function getTriggerTemplates(t: Translations = en): TriggerTemplate[] {
  const tplKeyMap: Record<string, { label: keyof Translations['triggers']; desc: keyof Translations['triggers'] }> = {
    'fw-error-logs':     { label: 'tpl_fw_error_logs',     desc: 'tpl_fw_error_logs_desc' },
    'fw-csv-data':       { label: 'tpl_fw_csv_data',       desc: 'tpl_fw_csv_data_desc' },
    'fw-config-changes': { label: 'tpl_fw_config_changes', desc: 'tpl_fw_config_changes_desc' },
    'cb-url-summarize':  { label: 'tpl_cb_url_summarize',  desc: 'tpl_cb_url_summarize_desc' },
    'cb-error-message':  { label: 'tpl_cb_error_message',  desc: 'tpl_cb_error_message_desc' },
    'cb-code-snippet':   { label: 'tpl_cb_code_snippet',   desc: 'tpl_cb_code_snippet_desc' },
  };
  return TRIGGER_TEMPLATES.map((tpl) => {
    const keys = tplKeyMap[tpl.id];
    if (!keys) return tpl;
    return {
      ...tpl,
      label: (t.triggers[keys.label] as string) ?? tpl.label,
      description: (t.triggers[keys.desc] as string) ?? tpl.description,
    };
  });
}

// -- Webhook URL configuration ----------------------------------------

/** Base URL for the webhook server. Override via VITE_WEBHOOK_BASE_URL env var for production. */
export const WEBHOOK_BASE_URL: string =
  (import.meta.env.VITE_WEBHOOK_BASE_URL as string | undefined) || 'http://localhost:9420';

/**
 * Whether a webhook base URL points at the loopback interface (dev mode).
 *
 * Structural, not a substring test. `WEBHOOK_BASE_URL` is operator-configurable
 * (`VITE_WEBHOOK_BASE_URL`), and `.includes('localhost')` — what this used to be
 * — answers yes for `https://localhost.example.com/hooks` and for any URL with
 * the word anywhere in its path or query. The dev-only affordance gated on the
 * flag then renders in production. Compare the parsed `hostname` against the
 * loopback names exactly instead; an unparseable URL is treated as non-local,
 * because the safe default for a dev affordance is "off".
 */
export function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // intentional: a malformed base URL is not evidence of a dev environment.
    return false;
  }
  // `new URL` keeps IPv6 hosts in brackets: `http://[::1]:9420` → `[::1]`.
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Whether the webhook URL is pointing at the default localhost (dev mode). */
export const IS_WEBHOOK_LOCALHOST: boolean = isLoopbackUrl(WEBHOOK_BASE_URL);

/** Build the full webhook URL for a given trigger ID. */
export function getWebhookUrl(triggerId: string): string {
  return `${WEBHOOK_BASE_URL}/webhook/${triggerId}`;
}

// -- Typed trigger config discriminated union ----------------------------

export interface ScheduleConfig extends Schedule {
  type: 'schedule';
  /** Max catch-up executions to enqueue when the trigger is overdue. Undefined
   *  or 1 = current fire-once-on-overdue behavior. Backend hard-caps at 100. */
  max_backfill?: number;
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
  { label: 'Per minute', value: 60 },       // i18n: triggers.rate_per_minute
  { label: 'Per 5 minutes', value: 300 },   // i18n: triggers.rate_per_5_minutes
  { label: 'Per hour', value: 3600 },       // i18n: triggers.rate_per_hour
] as const;

/** Look up the human-readable label for a trigger type. Falls back to Title Case. */
export function getTriggerTypeLabel(triggerType: string): string {
  return _labelByType.get(triggerType) ?? triggerType.charAt(0).toUpperCase() + triggerType.slice(1).replace(/_/g, ' ');
}

// Keyed by `string`, not `TriggerKind`: callers pass a raw stored
// `trigger_type`, and an unrecognised value must fall through to the Title Case
// branch rather than being a compile error at every call site.
const _labelByType = new Map<string, string>(TRIGGER_TYPE_OPTIONS.map((o) => [o.type, o.label]));

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
  /** Typed to the vocabulary: until 2026-08-17 all six templates below targeted
   *  a type the `persona_triggers` CHECK rejected, so the entire one-click
   *  quick-start strip failed with an anonymous error. */
  triggerType: TriggerKind;
  config: Record<string, unknown>;
}

export const TRIGGER_TEMPLATES: TriggerTemplate[] = [
  // File watcher templates
  {
    id: 'fw-error-logs',
    label: 'Auto-analyze error logs',                                         // i18n: triggers.tpl_fw_error_logs
    description: 'Triggers when new .log files appear or change in a folder', // i18n: triggers.tpl_fw_error_logs_desc
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
    label: 'Process new CSV files',                             // i18n: triggers.tpl_fw_csv_data
    description: 'Triggers when CSV files are added or modified', // i18n: triggers.tpl_fw_csv_data_desc
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
    label: 'Watch config file changes',                                            // i18n: triggers.tpl_fw_config_changes
    description: 'Triggers on changes to JSON, YAML, or TOML config files',        // i18n: triggers.tpl_fw_config_changes_desc
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
    label: 'Auto-summarize copied URLs',                                // i18n: triggers.tpl_cb_url_summarize
    description: 'Triggers when you copy a URL to your clipboard',      // i18n: triggers.tpl_cb_url_summarize_desc
    triggerType: 'clipboard',
    config: {
      content_type: 'text',
      pattern: 'https?://\\S+',
      interval_seconds: 3,
    },
  },
  {
    id: 'cb-error-message',
    label: 'Auto-diagnose error messages',                                            // i18n: triggers.tpl_cb_error_message
    description: 'Triggers when you copy text containing errors or exceptions',       // i18n: triggers.tpl_cb_error_message_desc
    triggerType: 'clipboard',
    config: {
      content_type: 'text',
      pattern: '(?i)(error|exception|traceback|panic|fatal|FAIL)',
      interval_seconds: 3,
    },
  },
  {
    id: 'cb-code-snippet',
    label: 'Auto-format code snippets',                                                    // i18n: triggers.tpl_cb_code_snippet
    description: 'Triggers when you copy code-like text (function definitions, imports)',   // i18n: triggers.tpl_cb_code_snippet_desc
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
    logger.warn("Trigger config.type does not match trigger_type column; using trigger_type as discriminant", {
      configType: raw.type,
      triggerType,
    });
  }

  switch (triggerType) {
    case 'schedule':
      return {
        type: 'schedule',
        cron: raw.cron as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        timezone: raw.timezone as string | undefined,
        max_backfill: raw.max_backfill as number | undefined,
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

/**
 * Internal: parse raw JSON/object/string into a plain object.
 *
 * Anything that is not a plain object collapses to `{}`. That guard is
 * load-bearing rather than defensive: `JSON.parse('null')` returns `null`, and
 * a `trigger_config` column holding the four characters `null` (which is what
 * `JSON.stringify(null)` writes) used to be handed back as-is, so the very next
 * statement in `parseTriggerConfig` — `typeof raw.type` — threw
 * "Cannot read properties of null" and took the whole trigger list down.
 * Arrays and scalars (`'5'`, `'"x"'`, `'[]'`) are equally not configs.
 */
function parseRawConfig(config: string | object | null | undefined): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === 'object') {
    return Array.isArray(config) ? {} : (config as Record<string, unknown>);
  }
  try {
    const parsed: unknown = JSON.parse(config);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return {};
  }
}

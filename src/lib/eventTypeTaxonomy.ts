/**
 * Canonical event_type taxonomy for persona event subscriptions.
 *
 * This is the single source of truth for all known event types in the system.
 * New event types MUST be registered here so they appear in subscription UIs,
 * filter dropdowns, and the event canvas palette.
 *
 * ## Naming convention
 *   - snake_case, lowercase
 *   - Format: `<noun>_<past_participle>` (e.g. `webhook_received`, `execution_completed`)
 *   - Max 128 chars, allowed chars: `[a-zA-Z0-9_\-.:\/]`
 *
 * ## Source filter matching
 *   Subscriptions can optionally include a `source_filter` to narrow matches
 *   by `source_id`. Two modes are supported:
 *
 *   - **Exact match**: `"webhook-1"` matches only events with `source_id === "webhook-1"`
 *   - **Prefix wildcard**: `"watcher-*"` matches any `source_id` starting with `"watcher-"`
 *
 *   Only a trailing `*` is supported. Regex, glob `?`, and `**` are NOT supported.
 *   If `source_filter` is set but the event has no `source_id`, the filter will not match.
 *
 *   Allowed characters: `[a-zA-Z0-9_:\-.*]` — max 120 chars, max 3 wildcard chars.
 */

import type { Translations } from '@/i18n/en';

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

export type EventTypeCategory = 'trigger' | 'execution' | 'system' | 'lifecycle' | 'test';

export interface EventTypeEntry {
  /** The event_type string used in subscriptions and event payloads */
  type: string;
  /** i18n key for the human-readable label (path inside event_types section) */
  labelKey: keyof Translations['event_types'];
  /** i18n key for the short description of when this event fires */
  descriptionKey: keyof Translations['event_types'];
  /** Logical grouping */
  category: EventTypeCategory;
  /** Typical source_type values that emit this event */
  typicalSources: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EVENT_TYPE_REGISTRY: EventTypeEntry[] = [
  // ── Trigger events ──────────────────────────────────────────────────────
  {
    type: 'webhook_received',
    labelKey: 'webhook_received_label',
    descriptionKey: 'webhook_received_description',
    category: 'trigger',
    typicalSources: ['webhook'],
  },
  {
    type: 'schedule_fired',
    labelKey: 'schedule_fired_label',
    descriptionKey: 'schedule_fired_description',
    category: 'trigger',
    typicalSources: ['scheduler'],
  },
  {
    type: 'polling_changed',
    labelKey: 'polling_changed_label',
    descriptionKey: 'polling_changed_description',
    category: 'trigger',
    typicalSources: ['poller'],
  },
  {
    type: 'file_changed',
    labelKey: 'file_changed_label',
    descriptionKey: 'file_changed_description',
    category: 'trigger',
    typicalSources: ['file_watcher'],
  },
  // ── Built-in Local Drive (Plugins.Drive) ────────────────────────────────
  {
    type: 'drive.document.added',
    labelKey: 'drive_document_added_label',
    descriptionKey: 'drive_document_added_description',
    category: 'trigger',
    typicalSources: ['local_drive'],
  },
  {
    type: 'drive.document.edited',
    labelKey: 'drive_document_edited_label',
    descriptionKey: 'drive_document_edited_description',
    category: 'trigger',
    typicalSources: ['local_drive'],
  },
  {
    type: 'drive.document.renamed',
    labelKey: 'drive_document_renamed_label',
    descriptionKey: 'drive_document_renamed_description',
    category: 'trigger',
    typicalSources: ['local_drive'],
  },
  {
    type: 'drive.document.deleted',
    labelKey: 'drive_document_deleted_label',
    descriptionKey: 'drive_document_deleted_description',
    category: 'trigger',
    typicalSources: ['local_drive'],
  },
  {
    type: 'clipboard_changed',
    labelKey: 'clipboard_changed_label',
    descriptionKey: 'clipboard_changed_description',
    category: 'trigger',
    typicalSources: ['clipboard_watcher'],
  },
  {
    type: 'app_focus_changed',
    labelKey: 'app_focus_changed_label',
    descriptionKey: 'app_focus_changed_description',
    category: 'trigger',
    typicalSources: ['app_focus_watcher'],
  },
  {
    type: 'chain_completed',
    labelKey: 'chain_completed_label',
    descriptionKey: 'chain_completed_description',
    category: 'trigger',
    typicalSources: ['chain_engine'],
  },
  {
    type: 'composite_fired',
    labelKey: 'composite_fired_label',
    descriptionKey: 'composite_fired_description',
    category: 'trigger',
    typicalSources: ['composite_engine'],
  },
  {
    type: 'trigger_fired',
    labelKey: 'trigger_fired_label',
    descriptionKey: 'trigger_fired_description',
    category: 'trigger',
    typicalSources: ['trigger_engine'],
  },
  {
    type: 'schedule_triggered',
    labelKey: 'schedule_triggered_label',
    descriptionKey: 'schedule_triggered_description',
    category: 'trigger',
    typicalSources: ['scheduler'],
  },

  // ── Execution events ────────────────────────────────────────────────────
  {
    type: 'execution_completed',
    labelKey: 'execution_completed_label',
    descriptionKey: 'execution_completed_description',
    category: 'execution',
    typicalSources: ['scheduler', 'runner'],
  },
  {
    type: 'execution_failed',
    labelKey: 'execution_failed_label',
    descriptionKey: 'execution_failed_description',
    category: 'execution',
    typicalSources: ['scheduler', 'runner'],
  },

  // ── System / persona events ─────────────────────────────────────────────
  {
    type: 'persona_action',
    labelKey: 'persona_action_label',
    descriptionKey: 'persona_action_description',
    category: 'system',
    typicalSources: ['persona', 'runner'],
  },
  {
    type: 'emit_event',
    labelKey: 'emit_event_label',
    descriptionKey: 'emit_event_description',
    category: 'system',
    typicalSources: ['persona'],
  },
  {
    type: 'credential_rotated',
    labelKey: 'credential_rotated_label',
    descriptionKey: 'credential_rotated_description',
    category: 'system',
    typicalSources: ['vault'],
  },
  {
    type: 'credential_event',
    labelKey: 'credential_event_label',
    descriptionKey: 'credential_event_description',
    category: 'system',
    typicalSources: ['vault'],
  },
  {
    type: 'credential_provisioned',
    labelKey: 'credential_provisioned_label',
    descriptionKey: 'credential_provisioned_description',
    category: 'system',
    typicalSources: ['vault'],
  },
  {
    type: 'memory_created',
    labelKey: 'memory_created_label',
    descriptionKey: 'memory_created_description',
    category: 'system',
    typicalSources: ['memory_engine'],
  },
  {
    type: 'task_created',
    labelKey: 'task_created_label',
    descriptionKey: 'task_created_description',
    category: 'system',
    typicalSources: ['task_engine'],
  },

  // ── Lifecycle / deployment events ───────────────────────────────────────
  {
    type: 'health_check_failed',
    labelKey: 'health_check_failed_label',
    descriptionKey: 'health_check_failed_description',
    category: 'lifecycle',
    typicalSources: ['health_monitor'],
  },
  {
    type: 'deployment_started',
    labelKey: 'deployment_started_label',
    descriptionKey: 'deployment_started_description',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'deploy_started',
    labelKey: 'deploy_started_label',
    descriptionKey: 'deploy_started_description',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'deploy_succeeded',
    labelKey: 'deploy_succeeded_label',
    descriptionKey: 'deploy_succeeded_description',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'deploy_failed',
    labelKey: 'deploy_failed_label',
    descriptionKey: 'deploy_failed_description',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'agent_undeployed',
    labelKey: 'agent_undeployed_label',
    descriptionKey: 'agent_undeployed_description',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'review_submitted',
    labelKey: 'review_submitted_label',
    descriptionKey: 'review_submitted_description',
    category: 'lifecycle',
    typicalSources: ['review_pipeline'],
  },

  // ── Test / development ──────────────────────────────────────────────────
  {
    type: 'test_event',
    labelKey: 'test_event_label',
    descriptionKey: 'test_event_description',
    category: 'test',
    typicalSources: ['test'],
  },
  {
    type: 'custom',
    labelKey: 'custom_label',
    descriptionKey: 'custom_description',
    category: 'system',
    typicalSources: [],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const _byType = new Map(EVENT_TYPE_REGISTRY.map((e) => [e.type, e]));

/** Look up a registered event type entry by its type string. */
export function getEventTypeEntry(type: string): EventTypeEntry | undefined {
  return _byType.get(type);
}

/** All registered type strings. */
export const ALL_EVENT_TYPES: string[] = EVENT_TYPE_REGISTRY.map((e) => e.type);

/** Get entries filtered by category. */
export function getEventTypesByCategory(category: EventTypeCategory): EventTypeEntry[] {
  return EVENT_TYPE_REGISTRY.filter((e) => e.category === category);
}

// ---------------------------------------------------------------------------
// i18n resolution helpers
// ---------------------------------------------------------------------------

/** Resolve the translated label for an event type entry. */
export function getEventTypeLabel(t: Translations, entry: EventTypeEntry): string {
  return t.event_types[entry.labelKey];
}

/** Resolve the translated description for an event type entry. */
export function getEventTypeDescription(t: Translations, entry: EventTypeEntry): string {
  return t.event_types[entry.descriptionKey];
}

/** Resolve the translated label for a category. */
export function getCategoryLabel(t: Translations, category: EventTypeCategory): string {
  return t.event_types[EVENT_TYPE_CATEGORIES[category].labelKey];
}

/** Resolve the translated description for a category. */
export function getCategoryDescription(t: Translations, category: EventTypeCategory): string {
  return t.event_types[EVENT_TYPE_CATEGORIES[category].descriptionKey];
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

/** Category metadata for display (uses i18n keys). */
export const EVENT_TYPE_CATEGORIES: Record<EventTypeCategory, {
  labelKey: keyof Translations['event_types'];
  descriptionKey: keyof Translations['event_types'];
}> = {
  trigger:   { labelKey: 'category_trigger_label',    descriptionKey: 'category_trigger_description' },
  execution: { labelKey: 'category_execution_label',  descriptionKey: 'category_execution_description' },
  system:    { labelKey: 'category_system_label',     descriptionKey: 'category_system_description' },
  lifecycle: { labelKey: 'category_lifecycle_label',  descriptionKey: 'category_lifecycle_description' },
  test:      { labelKey: 'category_test_label',       descriptionKey: 'category_test_description' },
};

// ---------------------------------------------------------------------------
// Subscription select options (for dropdowns)
// ---------------------------------------------------------------------------

/** Build options list for <select> / dropdown components (requires translation tree). */
export function getEventTypeOptions(t: Translations): { value: string; label: string; description: string }[] {
  return EVENT_TYPE_REGISTRY.map((e) => ({
    value: e.type,
    label: t.event_types[e.labelKey],
    description: t.event_types[e.descriptionKey],
  }));
}

/** Build grouped options by category for richer dropdown UIs (requires translation tree). */
export function getEventTypeOptionsGrouped(t: Translations): {
  category: EventTypeCategory;
  label: string;
  options: { value: string; label: string; description: string }[];
}[] {
  return (Object.keys(EVENT_TYPE_CATEGORIES) as EventTypeCategory[]).map((cat) => ({
    category: cat,
    label: t.event_types[EVENT_TYPE_CATEGORIES[cat].labelKey],
    options: getEventTypesByCategory(cat).map((e) => ({
      value: e.type,
      label: t.event_types[e.labelKey],
      description: t.event_types[e.descriptionKey],
    })),
  }));
}

// ---------------------------------------------------------------------------
// Source filter documentation (for UI help text)
// ---------------------------------------------------------------------------

export const SOURCE_FILTER_HELP = {
  titleKey: 'source_filter_title' as keyof Translations['event_types'],
  rules: [
    { pattern: 'webhook-1', explanationKey: 'source_filter_exact_match' as keyof Translations['event_types'] },
    { pattern: 'watcher-*', explanationKey: 'source_filter_prefix_wildcard' as keyof Translations['event_types'] },
  ],
  constraintKeys: [
    'source_filter_no_regex' as keyof Translations['event_types'],
    'source_filter_no_source_id' as keyof Translations['event_types'],
    'source_filter_allowed_chars' as keyof Translations['event_types'],
    'source_filter_max_length' as keyof Translations['event_types'],
  ],
} as const;

/** Resolve SOURCE_FILTER_HELP into display strings using translations. */
export function getSourceFilterHelp(t: Translations) {
  return {
    title: t.event_types[SOURCE_FILTER_HELP.titleKey],
    rules: SOURCE_FILTER_HELP.rules.map((r) => ({
      pattern: r.pattern,
      explanation: t.event_types[r.explanationKey],
    })),
    constraints: SOURCE_FILTER_HELP.constraintKeys.map((k) => t.event_types[k]),
  };
}

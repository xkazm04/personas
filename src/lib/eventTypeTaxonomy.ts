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

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

export type EventTypeCategory = 'trigger' | 'execution' | 'system' | 'lifecycle' | 'test';

export interface EventTypeEntry {
  /** The event_type string used in subscriptions and event payloads */
  type: string;
  /** Human-readable label for UI display */
  label: string;
  /** Short description of when this event fires */
  description: string;
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
    label: 'Webhook Received',
    description: 'Fires when an external webhook POST arrives',
    category: 'trigger',
    typicalSources: ['webhook'],
  },
  {
    type: 'schedule_fired',
    label: 'Schedule Fired',
    description: 'Fires when a cron or interval trigger executes',
    category: 'trigger',
    typicalSources: ['scheduler'],
  },
  {
    type: 'polling_changed',
    label: 'Polling Changed',
    description: 'Fires when a polled endpoint returns new content',
    category: 'trigger',
    typicalSources: ['poller'],
  },
  {
    type: 'file_changed',
    label: 'File Changed',
    description: 'Fires when a watched file or directory changes',
    category: 'trigger',
    typicalSources: ['file_watcher'],
  },
  {
    type: 'clipboard_changed',
    label: 'Clipboard Changed',
    description: 'Fires when clipboard content changes',
    category: 'trigger',
    typicalSources: ['clipboard_watcher'],
  },
  {
    type: 'app_focus_changed',
    label: 'App Focus Changed',
    description: 'Fires when the foreground application changes',
    category: 'trigger',
    typicalSources: ['app_focus_watcher'],
  },
  {
    type: 'chain_completed',
    label: 'Chain Completed',
    description: 'Fires when a chained persona finishes execution',
    category: 'trigger',
    typicalSources: ['chain_engine'],
  },
  {
    type: 'composite_fired',
    label: 'Composite Fired',
    description: 'Fires when a multi-condition composite trigger matches',
    category: 'trigger',
    typicalSources: ['composite_engine'],
  },
  {
    type: 'trigger_fired',
    label: 'Trigger Fired',
    description: 'Generic event emitted when any trigger activates',
    category: 'trigger',
    typicalSources: ['trigger_engine'],
  },
  {
    type: 'schedule_triggered',
    label: 'Schedule Triggered',
    description: 'Alias for schedule_fired — emitted by legacy schedule triggers',
    category: 'trigger',
    typicalSources: ['scheduler'],
  },

  // ── Execution events ────────────────────────────────────────────────────
  {
    type: 'execution_completed',
    label: 'Execution Completed',
    description: 'Fires when any persona execution completes successfully',
    category: 'execution',
    typicalSources: ['scheduler', 'runner'],
  },
  {
    type: 'execution_failed',
    label: 'Execution Failed',
    description: 'Fires when a persona execution fails',
    category: 'execution',
    typicalSources: ['scheduler', 'runner'],
  },

  // ── System / persona events ─────────────────────────────────────────────
  {
    type: 'persona_action',
    label: 'Persona Action',
    description: 'Fires when a persona emits a custom action during execution',
    category: 'system',
    typicalSources: ['persona', 'runner'],
  },
  {
    type: 'emit_event',
    label: 'Custom Emit',
    description: 'Fires when a persona emits a custom event via EmitEvent protocol',
    category: 'system',
    typicalSources: ['persona'],
  },
  {
    type: 'credential_rotated',
    label: 'Credential Rotated',
    description: 'Fires when a credential is rotated in the vault',
    category: 'system',
    typicalSources: ['vault'],
  },
  {
    type: 'credential_event',
    label: 'Credential Event',
    description: 'General credential lifecycle event (provisioned, revoked, etc.)',
    category: 'system',
    typicalSources: ['vault'],
  },
  {
    type: 'credential_provisioned',
    label: 'Credential Provisioned',
    description: 'Fires when a new credential is provisioned and ready for use',
    category: 'system',
    typicalSources: ['vault'],
  },
  {
    type: 'memory_created',
    label: 'Memory Created',
    description: 'Fires when a new memory entry is created',
    category: 'system',
    typicalSources: ['memory_engine'],
  },
  {
    type: 'task_created',
    label: 'Task Created',
    description: 'Fires when a new task is created for a persona',
    category: 'system',
    typicalSources: ['task_engine'],
  },

  // ── Lifecycle / deployment events ───────────────────────────────────────
  {
    type: 'health_check_failed',
    label: 'Health Check Failed',
    description: 'Fires when a persona health check fails',
    category: 'lifecycle',
    typicalSources: ['health_monitor'],
  },
  {
    type: 'deployment_started',
    label: 'Deployment Started',
    description: 'Fires when a cloud deployment begins',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'deploy_started',
    label: 'Deploy Started',
    description: 'Fires when a deployment process starts',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'deploy_succeeded',
    label: 'Deploy Succeeded',
    description: 'Fires when a deployment completes successfully',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'deploy_failed',
    label: 'Deploy Failed',
    description: 'Fires when a deployment fails',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'agent_undeployed',
    label: 'Agent Undeployed',
    description: 'Fires when an agent is removed from cloud deployment',
    category: 'lifecycle',
    typicalSources: ['cloud_deploy'],
  },
  {
    type: 'review_submitted',
    label: 'Review Submitted',
    description: 'Fires when a design or manual review is submitted',
    category: 'lifecycle',
    typicalSources: ['review_pipeline'],
  },

  // ── Test / development ──────────────────────────────────────────────────
  {
    type: 'test_event',
    label: 'Test Event',
    description: 'Fires during test flows and dry-run executions',
    category: 'test',
    typicalSources: ['test'],
  },
  {
    type: 'custom',
    label: 'Custom',
    description: 'User-defined event type for ad-hoc integrations',
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

/** Category metadata for display. */
export const EVENT_TYPE_CATEGORIES: Record<EventTypeCategory, { label: string; description: string }> = {
  trigger:   { label: 'Trigger Events',    description: 'Events emitted by trigger sources (webhooks, schedules, file watchers, etc.)' },
  execution: { label: 'Execution Events',  description: 'Events related to persona execution lifecycle' },
  system:    { label: 'System Events',     description: 'Events from internal systems (vault, memory, custom persona actions)' },
  lifecycle: { label: 'Lifecycle Events',  description: 'Events related to deployment, health checks, and reviews' },
  test:      { label: 'Test Events',       description: 'Events used during testing and dry-run flows' },
};

// ---------------------------------------------------------------------------
// Subscription select options (for dropdowns)
// ---------------------------------------------------------------------------

/** Pre-built options list for <select> / dropdown components. */
export const EVENT_TYPE_OPTIONS: { value: string; label: string; description: string }[] =
  EVENT_TYPE_REGISTRY.map((e) => ({
    value: e.type,
    label: e.label,
    description: e.description,
  }));

/** Grouped options by category for richer dropdown UIs. */
export const EVENT_TYPE_OPTIONS_GROUPED = (
  Object.keys(EVENT_TYPE_CATEGORIES) as EventTypeCategory[]
).map((cat) => ({
  category: cat,
  label: EVENT_TYPE_CATEGORIES[cat].label,
  options: getEventTypesByCategory(cat).map((e) => ({
    value: e.type,
    label: e.label,
    description: e.description,
  })),
}));

// ---------------------------------------------------------------------------
// Source filter documentation (for UI help text)
// ---------------------------------------------------------------------------

export const SOURCE_FILTER_HELP = {
  title: 'Source Filter Matching',
  rules: [
    { pattern: 'webhook-1', explanation: 'Exact match — only events with source_id "webhook-1"' },
    { pattern: 'watcher-*', explanation: 'Prefix wildcard — any source_id starting with "watcher-"' },
  ],
  constraints: [
    'Only trailing * is supported (no regex, no ? wildcards)',
    'If source_filter is set but the event has no source_id, the filter will not match',
    'Allowed characters: letters, numbers, _, -, :, ., and *',
    'Maximum 120 characters, maximum 3 wildcard characters',
  ],
} as const;

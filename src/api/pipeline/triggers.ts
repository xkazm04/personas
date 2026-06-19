import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaTrigger } from "@/lib/bindings/PersonaTrigger";
import type { PendingTriggerFire } from "@/lib/bindings/PendingTriggerFire";
import type { CreateTriggerInput } from "@/lib/bindings/CreateTriggerInput";
import type { UpdateTriggerInput } from "@/lib/bindings/UpdateTriggerInput";
import type { TriggerValidationResult } from "@/lib/bindings/TriggerValidationResult";
import type { WebhookStatus } from "@/lib/bindings/WebhookStatus";
import type { CronAgent } from "@/lib/bindings/CronAgent";
import type { RecentScheduleRun } from "@/lib/bindings/RecentScheduleRun";
import type { WebhookRequestLog } from "@/lib/bindings/WebhookRequestLog";

// ============================================================================
// Triggers
// ============================================================================

export const listAllTriggers = () =>
  invoke<PersonaTrigger[]>("list_all_triggers");

export const listTriggers = (personaId: string) =>
  invoke<PersonaTrigger[]>("list_triggers", { personaId });

export const createTrigger = (input: CreateTriggerInput) =>
  invoke<PersonaTrigger>("create_trigger", { input });

export const updateTrigger = (id: string, personaId: string, input: UpdateTriggerInput) =>
  invoke<PersonaTrigger>("update_trigger", { id, personaId, input });

export const deleteTrigger = (id: string, personaId: string) =>
  invoke<boolean>("delete_trigger", { id, personaId });

// ============================================================================
// Destructive-action gate (UAT P5): unattended-fire mode + approval queue
// ============================================================================

export type UnattendedMode = "auto" | "dry_run" | "approval";

/** Set a trigger's behavior when it fires UNATTENDED (schedule/event): fire
 *  normally ("auto"), run-but-suppress-outbound ("dry_run"), or hold for human
 *  approval ("approval"). */
export const setTriggerUnattendedMode = (id: string, personaId: string, mode: UnattendedMode) =>
  invoke<PersonaTrigger>("set_trigger_unattended_mode", { id, personaId, mode });

/** Trigger fires currently held awaiting human approval (approval mode). */
export const listPendingTriggerFires = () =>
  invoke<PendingTriggerFire[]>("list_pending_trigger_fires");

/** Approve (publish the held event → the run proceeds) or reject (discard) a
 *  held trigger fire. */
export const resolvePendingTriggerFire = (id: string, approved: boolean) =>
  invoke<PendingTriggerFire>("resolve_pending_trigger_fire", { id, approved });

// ============================================================================
// Builder: atomic persona <-> event linking
// See docs/design/event-routing-proposal.md
// ============================================================================

/**
 * Atomically create an event_listener trigger AND patch the persona's
 * structured_prompt.eventHandlers with matching handler text. The persona
 * will actually react to the wired event at runtime.
 *
 * Pass `useCaseId` to scope the trigger to a specific capability (Phase C4);
 * omit / `null` → persona-wide.
 */
export const linkPersonaToEvent = (
  personaId: string,
  eventType: string,
  options?: { handlerText?: string; useCaseId?: string | null },
) =>
  invoke<PersonaTrigger>("link_persona_to_event", {
    personaId,
    eventType,
    handlerText: options?.handlerText ?? null,
    useCaseId: options?.useCaseId ?? null,
  });

/** Inverse: delete the event_listener trigger AND remove its handler entry. */
export const unlinkPersonaFromEvent = (triggerId: string) =>
  invoke<boolean>("unlink_persona_from_event", { triggerId });

/** Update a single handler's text. Creates the eventHandlers map if needed. */
export const updatePersonaEventHandler = (
  personaId: string,
  eventType: string,
  handlerText: string,
) =>
  invoke<boolean>("update_persona_event_handler", {
    personaId,
    eventType,
    handlerText,
  });

// ============================================================================
// Trigger / event cleanup (Fix 1 + Fix 4a)
// Self-healing sweep for dead trigger audit rows + missing auto-listeners.
// See docs/design/event-routing-proposal.md
// ============================================================================

export interface TriggerCleanupResult {
  orphaned_triggers_deleted: number;
  orphaned_events_deleted: number;
  auto_listeners_backfilled: number;
  source_triggers_scanned: number;
}

/**
 * One-shot cleanup for the trigger / event subsystem. Deletes triggers whose
 * owning persona is gone, purges dead `trigger_fired` audit rows, and
 * backfills missing auto-listeners for pre-existing schedule/polling/webhook
 * triggers. Idempotent.
 */
export const cleanupDeadTriggerEvents = () =>
  invoke<TriggerCleanupResult>("cleanup_dead_trigger_events");

// ============================================================================
// Rename event type — atomic across every store that references it
// See docs/design/event-routing-proposal.md + src-tauri/src/db/repos/resources/triggers.rs
// ============================================================================

export interface RenameEventTypeResult {
  events_updated: number;
  subscriptions_updated: number;
  trigger_publishers_updated: number;
  trigger_listeners_updated: number;
  handler_keys_updated: number;
  persona_handlers_updated: number;
}

/**
 * Atomically rename an event type everywhere it's referenced:
 * `persona_events`, `persona_event_subscriptions`, `persona_triggers.config`
 * (event_type / listen_event_type / _handler_key), and
 * `personas.structured_prompt.eventHandlers`. Rejects reserved infrastructure
 * event types (catalog) and collisions (if the new name already exists
 * anywhere). Returns per-store counts.
 */
export const renameEventType = (oldEventType: string, newEventType: string) =>
  invoke<RenameEventTypeResult>("rename_event_type", {
    oldEventType,
    newEventType,
  });

// ============================================================================
// Trigger Health
// ============================================================================

export const getTriggerHealthMap = () =>
  invoke<Record<string, string>>("get_trigger_health_map");

// ============================================================================
// Trigger Validation
// ============================================================================

export const validateTrigger = (id: string) =>
  invoke<TriggerValidationResult>("validate_trigger", { id });

// ============================================================================
// Cron Preview
// ============================================================================

export interface CronPreview {
  valid: boolean;
  description: string;
  next_runs: string[];
  error: string | null;
}

export const previewCronSchedule = (
  cronExpression: string,
  count?: number,
  timezone?: string,
  /**
   * Stable id (usually `trigger.id`) hashed into Jenkins `H` tokens so the
   * preview matches the minute the engine will actually fire. Omit for
   * syntax-only previews where the seed doesn't matter yet (eg new trigger
   * draft before the id is assigned).
   */
  seed?: string,
) => invoke<CronPreview>("preview_cron_schedule", { cronExpression, count, timezone, seed });

/**
 * Compute every cron fire time within `[start, end)`, evaluated in the supplied
 * IANA timezone (or system-local when undefined). Used by the calendar UI to
 * render a windowed view of upcoming and past-projected fires.
 *
 * Returns RFC3339 strings, ascending. Returns an empty array when the cron
 * expression is invalid (use `previewCronSchedule` for validation feedback).
 *
 * `max` defaults to 200, hard-capped at 1000 by the backend. Pass `seed`
 * (typically the trigger id) so Jenkins-style `H` tokens expand to the same
 * minute the scheduler will actually use.
 */
export const cronFireTimesInRange = (
  cronExpression: string,
  timezone: string | undefined,
  start: Date,
  end: Date,
  max?: number,
  seed?: string,
) => invoke<string[]>("cron_fire_times_in_range", {
  cronExpression,
  timezone,
  start: start.toISOString(),
  end: end.toISOString(),
  max,
  seed,
});

// ============================================================================
// Webhook Server
// ============================================================================

export const getWebhookStatus = () =>
  invoke<WebhookStatus>("get_webhook_status");

// ============================================================================
// Dry Run
// ============================================================================

export interface DryRunSimulatedEvent {
  event_type: string;
  source_type: string;
  source_id: string;
  target_persona_id: string | null;
  target_persona_name: string | null;
  payload: Record<string, unknown>;
}

export interface DryRunMatchedSubscription {
  subscription_id: string;
  persona_id: string;
  persona_name: string;
  event_type: string;
  source_filter: string | null;
}

export interface DryRunResult {
  valid: boolean;
  validation: import("@/lib/bindings/TriggerValidationResult").TriggerValidationResult;
  simulated_event: DryRunSimulatedEvent | null;
  matched_subscriptions: DryRunMatchedSubscription[];
}

export const dryRunTrigger = (id: string) =>
  invoke<DryRunResult>("dry_run_trigger", { id });

// ============================================================================
// Cron Agents
// ============================================================================

export const listCronAgents = () =>
  invoke<CronAgent[]>("list_cron_agents");

export const seedMockCronAgent = () =>
  invoke<CronAgent>("seed_mock_cron_agent", {});

export const listRecentScheduleRuns = (hours?: number) =>
  invoke<RecentScheduleRun[]>("list_recent_schedule_runs", { hours });

// ============================================================================
// Webhook Request Inspector
// ============================================================================

export const listWebhookRequestLogs = (triggerId: string) =>
  invoke<WebhookRequestLog[]>("list_webhook_request_logs", { triggerId });

export const clearWebhookRequestLogs = (triggerId: string) =>
  invoke<number>("clear_webhook_request_logs", { triggerId });

export const replayWebhookRequest = (logId: string) =>
  invoke<string>("replay_webhook_request", { logId });

export const webhookRequestToCurl = (logId: string) =>
  invoke<string>("webhook_request_to_curl", { logId });

// ============================================================================
// Composite Partial-Match Observability
// ============================================================================

import type { PartialMatchResult } from "@/lib/bindings/PartialMatchResult";

export const getCompositePartialMatches = () =>
  invoke<PartialMatchResult[]>("get_composite_partial_matches");

export const getCompositePartialMatch = (triggerId: string) =>
  invoke<PartialMatchResult | null>("get_composite_partial_match", { triggerId });

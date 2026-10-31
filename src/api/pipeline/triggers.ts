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
import type { TriggerCleanupResult } from "@/lib/bindings/TriggerCleanupResult";
import type { RenameEventTypeResult } from "@/lib/bindings/RenameEventTypeResult";
import type { CronPreview } from "@/lib/bindings/CronPreview";
import type { DryRunResult } from "@/lib/bindings/DryRunResult";
import type { DryRunSimulatedEvent } from "@/lib/bindings/DryRunSimulatedEvent";
import type { DryRunMatchedSubscription } from "@/lib/bindings/DryRunMatchedSubscription";

// ============================================================================
// Triggers
// ============================================================================

export const listAllTriggers = (limit?: number) =>
  invoke<PersonaTrigger[]>("list_all_triggers", { limit });

export const listTriggers = (personaId: string) =>
  invoke<PersonaTrigger[]>("list_triggers", { personaId });

export const createTrigger = (input: CreateTriggerInput) =>
  invoke<PersonaTrigger>("create_trigger", { input });

// `Partial<>` since 2026-08-15. `next_trigger_at` is `Option<Option<String>>`
// with `double_option` (src-tauri/core/src/models/trigger.rs:626-627), so callers filling in
// `next_trigger_at: null` to satisfy a required field were CLEARING the column,
// not leaving it alone.
//
// That is not cosmetic: `get_due` requires `next_trigger_at IS NOT NULL`
// (src-tauri/db/src/repos/resources/triggers/scheduling.rs:139) and it is the only source of scheduler
// work, so a NULLed trigger stops firing permanently and reports success. The
// guard written to prevent exactly this — `input.next_trigger_at.is_none()` at
// src-tauri/db/src/repos/resources/triggers/definitions.rs:447 — does not fire, because an explicit null
// deserializes to `Some(None)` whose `is_none()` is false. So the column was
// nulled AND the cron recompute was skipped.
//
// Send only the keys you are changing; omitting `next_trigger_at` is what makes
// the backend recompute it.
export const updateTrigger = (id: string, personaId: string, input: Partial<UpdateTriggerInput>) =>
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

// ============================================================================
// Trigger / event cleanup (Fix 1 + Fix 4a)
// Self-healing sweep for dead trigger audit rows + missing auto-listeners.
// ============================================================================

// The wire shape is the ts-rs binding (`commands/tools/triggers.rs`), not a
// hand-copied interface that can drift from it.
export type { TriggerCleanupResult };

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
// See src-tauri/db/src/repos/resources/triggers/event_wiring.rs (rename_event_type)
// ============================================================================

// The binding, not a hand copy: the Rust struct is `rename_all = "camelCase"`
// (db/src/repos/resources/triggers/event_wiring.rs), and the copy that stood
// here spelled all six fields snake_case, so every read of the result was
// typed `number` and was `undefined` at runtime.
export type { RenameEventTypeResult };

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

// The binding, not a hand copy (`commands/tools/triggers.rs` CronPreview).
export type { CronPreview };

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

// The bindings, not hand copies. The copy that stood here had drifted from the
// wire: it dropped `chain_targets`, typed `simulated_event` and the target
// persona fields as nullable (Rust always sends them) and `payload` as never
// null (it is `Option<serde_json::Value>`). Pinned by
// __tests__/noHandCopiedBindings.test.ts.
export type { DryRunResult, DryRunSimulatedEvent, DryRunMatchedSubscription };

export const dryRunTrigger = (id: string) =>
  invoke<DryRunResult>("dry_run_trigger", { id });

// ============================================================================
// Cron Agents
// ============================================================================

export const listCronAgents = () =>
  invoke<CronAgent[]>("list_cron_agents");

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

// ============================================================================
// Persona Config Warnings
// ============================================================================

import type { ConfigWarning } from "@/lib/bindings/ConfigWarning";

/**
 * Validate a persona's chain-trigger configs and tool kinds, returning any
 * warnings. Lives here (not with the health API) because every sub-check reads
 * trigger rows — `commands::tools::triggers::get_persona_config_warnings`.
 *
 * Best-effort by contract: a caller that only needs a coverage signal should
 * treat a rejection as "warnings unavailable", not as a failed health check.
 */
export const getPersonaConfigWarnings = (personaId: string) =>
  invoke<ConfigWarning[]>("get_persona_config_warnings", { personaId });

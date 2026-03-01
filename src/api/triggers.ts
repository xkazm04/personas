import { invoke } from "@tauri-apps/api/core";

import type { PersonaTrigger } from "@/lib/bindings/PersonaTrigger";
import type { CreateTriggerInput } from "@/lib/bindings/CreateTriggerInput";
import type { UpdateTriggerInput } from "@/lib/bindings/UpdateTriggerInput";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";
import type { TriggerValidationResult } from "@/lib/bindings/TriggerValidationResult";
import type { WebhookStatus } from "@/lib/bindings/WebhookStatus";

// ============================================================================
// Triggers
// ============================================================================

export const listAllTriggers = () =>
  invoke<PersonaTrigger[]>("list_all_triggers");

export const listTriggers = (personaId: string) =>
  invoke<PersonaTrigger[]>("list_triggers", { personaId });

export const createTrigger = (input: CreateTriggerInput) =>
  invoke<PersonaTrigger>("create_trigger", { input });

export const updateTrigger = (id: string, input: UpdateTriggerInput) =>
  invoke<PersonaTrigger>("update_trigger", { id, input });

export const deleteTrigger = (id: string) =>
  invoke<boolean>("delete_trigger", { id });

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

export const previewCronSchedule = (cronExpression: string, count?: number) =>
  invoke<CronPreview>("preview_cron_schedule", { cronExpression, count: count ?? null });

// ============================================================================
// Chain Triggers
// ============================================================================

export const listTriggerChains = () =>
  invoke<TriggerChainLink[]>("list_trigger_chains");

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

export interface DryRunChainTarget {
  trigger_id: string;
  target_persona_id: string;
  target_persona_name: string;
  condition_type: string;
  enabled: boolean;
}

export interface DryRunResult {
  valid: boolean;
  validation: import("@/lib/bindings/TriggerValidationResult").TriggerValidationResult;
  simulated_event: DryRunSimulatedEvent | null;
  matched_subscriptions: DryRunMatchedSubscription[];
  chain_targets: DryRunChainTarget[];
}

export const dryRunTrigger = (id: string) =>
  invoke<DryRunResult>("dry_run_trigger", { id });

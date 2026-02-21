import { invoke } from "@tauri-apps/api/core";

import type { PersonaTrigger } from "@/lib/bindings/PersonaTrigger";
import type { CreateTriggerInput } from "@/lib/bindings/CreateTriggerInput";
import type { UpdateTriggerInput } from "@/lib/bindings/UpdateTriggerInput";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";
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
// Chain Triggers
// ============================================================================

export const listTriggerChains = () =>
  invoke<TriggerChainLink[]>("list_trigger_chains");

// ============================================================================
// Webhook Server
// ============================================================================

export const getWebhookStatus = () =>
  invoke<WebhookStatus>("get_webhook_status");

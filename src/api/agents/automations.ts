import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { BlastRadiusItem } from "@/api/agents/personas";
import type { PersonaAutomation } from "@/lib/bindings/PersonaAutomation";
import type { AutomationRun } from "@/lib/bindings/AutomationRun";
import type { CreateAutomationInput } from "@/lib/bindings/CreateAutomationInput";
import type { UpdateAutomationInput } from "@/lib/bindings/UpdateAutomationInput";
import type { N8nWorkflow } from "@/lib/bindings/N8nWorkflow";
import type { N8nActivateResult } from "@/lib/bindings/N8nActivateResult";
import type { GitHubRepo } from "@/lib/bindings/GitHubRepo";
import type { GitHubPermissions } from "@/lib/bindings/GitHubPermissions";
import type { DeployAutomationInput } from "@/lib/bindings/DeployAutomationInput";
import type { DeployAutomationResult } from "@/lib/bindings/DeployAutomationResult";

export type { N8nWorkflow } from "@/lib/bindings/N8nWorkflow";
export type { N8nActivateResult } from "@/lib/bindings/N8nActivateResult";
export type { ZapierStep } from "@/lib/bindings/ZapierStep";
export type { ZapierWebhookResult } from "@/lib/bindings/ZapierWebhookResult";
export type { GitHubRepo } from "@/lib/bindings/GitHubRepo";
export type { GitHubPermissions } from "@/lib/bindings/GitHubPermissions";
export type { DeployAutomationInput } from "@/lib/bindings/DeployAutomationInput";
export type { DeployAutomationResult } from "@/lib/bindings/DeployAutomationResult";

export const listAutomations = (personaId: string) =>
  invoke<PersonaAutomation[]>("list_automations", { personaId });

export const getAutomation = (id: string) =>
  invoke<PersonaAutomation>("get_automation", { id });

export const createAutomation = (input: CreateAutomationInput) =>
  invoke<PersonaAutomation>("create_automation", { input });

/**
 * Update an automation. **Send only the fields you intend to change.**
 *
 * `Partial<>` is load-bearing, not a convenience. `UpdateAutomationInput`'s
 * generated type declares every field REQUIRED (`string | null`), because ts-rs
 * emits `Option<Option<T>>` as `T | null | null` and TypeScript collapses that
 * to `T | null` with no `?`. So a caller writing type-correct code was FORCED to
 * name every field, and the only value available was `null` — which for the nine
 * fields carrying `#[serde(default, deserialize_with = "double_option")]` means
 * CLEAR, not "leave alone". The generated type made data loss mandatory.
 *
 * On the wire, omission is the correct spelling of "leave alone": the
 * double_option fields have `#[serde(default)]`, and serde maps a missing plain
 * `Option<T>` to `None`. Verified against
 * `UpdateAutomationInput` in `src-tauri/core/src/models/automation.rs`.
 *
 * The real fix is `#[ts(optional)]` on those Rust fields so the generated type
 * says `field?: T | null`; that needs a binding regen. Until then this signature
 * is what stops the loss. See docs/concepts/golden-paths/partial-update-semantics.md.
 */
export const updateAutomation = (id: string, input: Partial<UpdateAutomationInput>) =>
  invoke<PersonaAutomation>("update_automation", { id, input });

export const deleteAutomation = (id: string) =>
  invoke<boolean>("delete_automation", { id });

export const getAutomationBlastRadius = (id: string) =>
  invoke<BlastRadiusItem[]>("automation_blast_radius", { id });

// -- Run budget -------------------------------------------------------------
// `trigger_automation` and `test_automation_webhook` await the outbound webhook
// inline (engine/src/automation_runner.rs `invoke_automation`): up to
// `retry_count.clamp(1, 5)` attempts, each allowed `timeout_ms.max(1000)`, with
// a `min(1000 * 2^(n-1), MAX_BACKOFF_MS)` sleep between attempts. The editor
// lets a user set the per-attempt timeout up to an hour, so the 90 s IPC
// default gave up on a run the backend was still finishing: the UI reported
// "Failed to trigger automation" for a webhook that then fired anyway, and a
// retry fired it twice. These mirror the Rust figures; a test reads the Rust
// source so the two cannot drift.
export const AUTOMATION_MAX_ATTEMPTS = 5;
export const AUTOMATION_MIN_ATTEMPT_MS = 1_000;
export const AUTOMATION_MAX_BACKOFF_MS = 30_000;
/** Auth resolution before the first attempt plus the run-row writes after the last. */
const AUTOMATION_RUN_MARGIN_MS = 30_000;
/** Used when the caller does not know the automation's own settings. */
const AUTOMATION_UNKNOWN_BUDGET_MS = 30 * 60_000;

export interface AutomationRunSettings {
  /** ts-rs types the i64 as bigint; it arrives as a JSON number. */
  timeoutMs: bigint | number;
  retryCount: number;
}

/** Worst-case wall time of one `invoke_automation` call, plus a margin. */
export function automationRunBudgetMs(settings?: AutomationRunSettings | null): number {
  if (!settings) return AUTOMATION_UNKNOWN_BUDGET_MS;
  const perAttempt = Math.max(Number(settings.timeoutMs) || 0, AUTOMATION_MIN_ATTEMPT_MS);
  const attempts = Math.min(Math.max(Math.trunc(settings.retryCount) || 1, 1), AUTOMATION_MAX_ATTEMPTS);
  let backoff = 0;
  for (let n = 1; n < attempts; n++) backoff += Math.min(1000 * 2 ** (n - 1), AUTOMATION_MAX_BACKOFF_MS);
  return attempts * perAttempt + backoff + AUTOMATION_RUN_MARGIN_MS;
}

export const triggerAutomation = (
  id: string,
  inputData?: string | null,
  executionId?: string | null,
  settings?: AutomationRunSettings | null,
) =>
  invoke<AutomationRun>(
    "trigger_automation",
    { id, inputData: inputData, executionId: executionId },
    { timeoutMs: automationRunBudgetMs(settings) },
  );

export const testAutomationWebhook = (id: string, settings?: AutomationRunSettings | null) =>
  invoke<AutomationRun>("test_automation_webhook", { id }, { timeoutMs: automationRunBudgetMs(settings) });

export const getAutomationRuns = (automationId: string, limit?: number | null) =>
  invoke<AutomationRun[]>("get_automation_runs", { automationId, limit: limit });

// AI-assisted automation design
export const startAutomationDesign = (personaId: string, description: string) =>
  invoke<{ design_id: string }>("start_automation_design", { personaId, description });

export const cancelAutomationDesign = () =>
  invoke<void>("cancel_automation_design");

// n8n Platform API

export const n8nListWorkflows = (credentialId: string) =>
  invoke<N8nWorkflow[]>("n8n_list_workflows", { credentialId });

export const n8nActivateWorkflow = (credentialId: string, workflowId: string) =>
  invoke<N8nActivateResult>("n8n_activate_workflow", { credentialId, workflowId });

export const n8nDeactivateWorkflow = (credentialId: string, workflowId: string) =>
  invoke<N8nActivateResult>("n8n_deactivate_workflow", { credentialId, workflowId });

export const n8nCreateWorkflow = (credentialId: string, definition: Record<string, unknown>) =>
  invoke<Record<string, unknown>>("n8n_create_workflow", { credentialId, definition });

export const n8nTriggerWebhook = (credentialId: string, webhookUrl: string, body?: Record<string, unknown>) =>
  invoke<Record<string, unknown>>("n8n_trigger_webhook", { credentialId, webhookUrl, body: body });

// GitHub Platform API

export const githubListRepos = (credentialId: string) =>
  invoke<GitHubRepo[]>("github_list_repos", { credentialId });

export const githubCheckPermissions = (credentialId: string) =>
  invoke<GitHubPermissions>("github_check_permissions", { credentialId });

// Deploy Automation (platform-smart deploy + save)

export const deployAutomation = (input: DeployAutomationInput) =>
  invoke<DeployAutomationResult>("deploy_automation", { input });

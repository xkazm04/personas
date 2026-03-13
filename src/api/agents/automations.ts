import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { PersonaAutomation, AutomationRun, CreateAutomationInput, UpdateAutomationInput } from "@/lib/bindings/PersonaAutomation";
import type { N8nWorkflow } from "@/lib/bindings/N8nWorkflow";
import type { N8nActivateResult } from "@/lib/bindings/N8nActivateResult";
import type { ZapierZap } from "@/lib/bindings/ZapierZap";
import type { ZapierWebhookResult } from "@/lib/bindings/ZapierWebhookResult";
import type { GitHubRepo } from "@/lib/bindings/GitHubRepo";
import type { GitHubPermissions } from "@/lib/bindings/GitHubPermissions";
import type { DeployAutomationInput } from "@/lib/bindings/DeployAutomationInput";
import type { DeployAutomationResult } from "@/lib/bindings/DeployAutomationResult";

export type { N8nWorkflow } from "@/lib/bindings/N8nWorkflow";
export type { N8nActivateResult } from "@/lib/bindings/N8nActivateResult";
export type { ZapierZap } from "@/lib/bindings/ZapierZap";
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

export const updateAutomation = (id: string, input: UpdateAutomationInput) =>
  invoke<PersonaAutomation>("update_automation", { id, input });

export const deleteAutomation = (id: string) =>
  invoke<boolean>("delete_automation", { id });

export const triggerAutomation = (id: string, inputData?: string | null, executionId?: string | null) =>
  invoke<AutomationRun>("trigger_automation", { id, inputData: inputData ?? null, executionId: executionId ?? null });

export const testAutomationWebhook = (id: string) =>
  invoke<AutomationRun>("test_automation_webhook", { id });

export const getAutomationRuns = (automationId: string, limit?: number | null) =>
  invoke<AutomationRun[]>("get_automation_runs", { automationId, limit: limit ?? null });

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
  invoke<Record<string, unknown>>("n8n_trigger_webhook", { credentialId, webhookUrl, body: body ?? null });

// Zapier Platform API

export const zapierListZaps = (credentialId: string) =>
  invoke<ZapierZap[]>("zapier_list_zaps", { credentialId });

export const zapierCreateZap = (credentialId: string, definition: Record<string, unknown>) =>
  invoke<{ zapId: string; webhookUrl: string | null }>("zapier_create_zap", { credentialId, definition });

export const zapierTriggerWebhook = (credentialId: string, webhookUrl: string, body?: Record<string, unknown>) =>
  invoke<ZapierWebhookResult>("zapier_trigger_webhook", { credentialId, webhookUrl, body: body ?? null });

// GitHub Platform API

export const githubListRepos = (credentialId: string) =>
  invoke<GitHubRepo[]>("github_list_repos", { credentialId });

export const githubCheckPermissions = (credentialId: string) =>
  invoke<GitHubPermissions>("github_check_permissions", { credentialId });

// Deploy Automation (platform-smart deploy + save)

export const deployAutomation = (input: DeployAutomationInput) =>
  invoke<DeployAutomationResult>("deploy_automation", { input });

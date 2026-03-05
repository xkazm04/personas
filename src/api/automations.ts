import { invoke } from "@tauri-apps/api/core";
import type { PersonaAutomation, AutomationRun, CreateAutomationInput, UpdateAutomationInput } from "@/lib/bindings/PersonaAutomation";

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
export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface N8nActivateResult {
  id: string;
  active: boolean;
}

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

// GitHub Platform API
export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubPermissions {
  hasRepo: boolean;
  hasWorkflow: boolean;
  scopes: string[];
}

export const githubListRepos = (credentialId: string) =>
  invoke<GitHubRepo[]>("github_list_repos", { credentialId });

export const githubCheckPermissions = (credentialId: string) =>
  invoke<GitHubPermissions>("github_check_permissions", { credentialId });

// Deploy Automation (platform-smart deploy + save)
export interface DeployAutomationInput {
  personaId: string;
  credentialId: string;
  designResult: Record<string, unknown>;
  githubRepo?: string | null;
  useCaseId?: string | null;
}

export interface DeployAutomationResult {
  automation: PersonaAutomation;
  platformUrl: string | null;
  webhookUrl: string | null;
  deploymentMessage: string;
}

export const deployAutomation = (input: DeployAutomationInput) =>
  invoke<DeployAutomationResult>("deploy_automation", { input });

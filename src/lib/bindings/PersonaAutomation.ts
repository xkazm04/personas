/** Mirrors src-tauri/src/db/models/automation.rs — PersonaAutomation */
export interface PersonaAutomation {
  id: string;
  personaId: string;
  useCaseId: string | null;
  name: string;
  description: string;
  platform: AutomationPlatform;
  platformWorkflowId: string | null;
  platformUrl: string | null;
  webhookUrl: string | null;
  webhookMethod: string;
  platformCredentialId: string | null;
  credentialMapping: string | null;
  inputSchema: string | null;
  outputSchema: string | null;
  timeoutMs: number;
  retryCount: number;
  fallbackMode: AutomationFallbackMode;
  deploymentStatus: AutomationDeploymentStatus;
  lastTriggeredAt: string | null;
  lastResultStatus: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationPlatform = "n8n" | "github_actions" | "zapier" | "custom";
export type AutomationFallbackMode = "connector" | "fail" | "skip";
export type AutomationDeploymentStatus = "draft" | "active" | "paused" | "error";

/** Mirrors AutomationRun */
export interface AutomationRun {
  id: string;
  automationId: string;
  executionId: string | null;
  status: AutomationRunStatus;
  inputData: string | null;
  outputData: string | null;
  platformRunId: string | null;
  platformLogsUrl: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export type AutomationRunStatus = "pending" | "running" | "completed" | "failed" | "timeout";

/** Mirrors CreateAutomationInput */
export interface CreateAutomationInput {
  personaId: string;
  useCaseId?: string | null;
  name: string;
  description?: string | null;
  platform: AutomationPlatform;
  platformWorkflowId?: string | null;
  platformUrl?: string | null;
  webhookUrl?: string | null;
  webhookMethod?: string | null;
  platformCredentialId?: string | null;
  credentialMapping?: string | null;
  inputSchema?: string | null;
  outputSchema?: string | null;
  timeoutMs?: number | null;
  retryCount?: number | null;
  fallbackMode?: string | null;
}

/** Mirrors UpdateAutomationInput */
export interface UpdateAutomationInput {
  name?: string | null;
  description?: string | null;
  useCaseId?: string | null;
  platformWorkflowId?: string | null;
  platformUrl?: string | null;
  webhookUrl?: string | null;
  webhookMethod?: string | null;
  platformCredentialId?: string | null;
  credentialMapping?: string | null;
  inputSchema?: string | null;
  outputSchema?: string | null;
  timeoutMs?: number | null;
  retryCount?: number | null;
  fallbackMode?: string | null;
  deploymentStatus?: AutomationDeploymentStatus | null;
  errorMessage?: string | null;
}

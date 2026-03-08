import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CloudConfig } from "@/lib/bindings/CloudConfig";
import type { CloudStatusResponse } from "@/lib/bindings/CloudStatusResponse";
import type { CloudOAuthAuthorizeResponse } from "@/lib/bindings/CloudOAuthAuthorizeResponse";
import type { CloudOAuthStatusResponse } from "@/lib/bindings/CloudOAuthStatusResponse";

export type { CloudConfig } from "@/lib/bindings/CloudConfig";
export type { CloudWorkerCounts } from "@/lib/bindings/CloudWorkerCounts";
export type { CloudStatusResponse } from "@/lib/bindings/CloudStatusResponse";
export type { CloudOAuthAuthorizeResponse } from "@/lib/bindings/CloudOAuthAuthorizeResponse";
export type { CloudOAuthStatusResponse } from "@/lib/bindings/CloudOAuthStatusResponse";

// Config
export const cloudConnect = (url: string, apiKey: string) =>
  invoke<void>("cloud_connect", { url, apiKey });

export const cloudReconnectFromKeyring = () =>
  invoke<void>("cloud_reconnect_from_keyring");

export const cloudDisconnect = () =>
  invoke<void>("cloud_disconnect");

export const cloudGetConfig = () =>
  invoke<CloudConfig | null>("cloud_get_config");

// Status
export const cloudStatus = () =>
  invoke<CloudStatusResponse>("cloud_status");

// Execution
export const cloudExecutePersona = (personaId: string, inputData?: string) =>
  invoke<string>("cloud_execute_persona", { personaId, inputData });

export const cloudCancelExecution = (executionId: string) =>
  invoke<boolean>("cloud_cancel_execution", { executionId });

// OAuth
export const cloudOAuthAuthorize = () =>
  invoke<CloudOAuthAuthorizeResponse>("cloud_oauth_authorize");

export const cloudOAuthCallback = (code: string, oauthState: string) =>
  invoke<unknown>("cloud_oauth_callback", { code, oauthState });

export const cloudOAuthStatus = () =>
  invoke<CloudOAuthStatusResponse>("cloud_oauth_status");

export const cloudOAuthRefresh = () =>
  invoke<unknown>("cloud_oauth_refresh");

export const cloudOAuthDisconnect = () =>
  invoke<void>("cloud_oauth_disconnect");

// Deployments

export interface CloudDeployment {
  id: string;
  project_id: string;
  persona_id: string;
  slug: string;
  label: string;
  status: string;
  webhook_enabled: boolean;
  webhook_secret: string | null;
  invocation_count: number;
  last_invoked_at: string | null;
  max_monthly_budget_usd: number | null;
  current_month_cost_usd: number | null;
  budget_month: string | null;
  created_at: string;
  updated_at: string;
}

export const cloudDeployPersona = (personaId: string, maxMonthlyBudgetUsd?: number) =>
  invoke<CloudDeployment>("cloud_deploy_persona", { personaId, maxMonthlyBudgetUsd: maxMonthlyBudgetUsd ?? null });

export const cloudListDeployments = () =>
  invoke<CloudDeployment[]>("cloud_list_deployments");

export const cloudPauseDeployment = (deploymentId: string) =>
  invoke<CloudDeployment>("cloud_pause_deployment", { deploymentId });

export const cloudResumeDeployment = (deploymentId: string) =>
  invoke<CloudDeployment>("cloud_resume_deployment", { deploymentId });

export const cloudUndeploy = (deploymentId: string) =>
  invoke<void>("cloud_undeploy", { deploymentId });

export const cloudGetBaseUrl = () =>
  invoke<string | null>("cloud_get_base_url");

// Cloud Reviews (human-in-the-loop)

export interface CloudReviewRequest {
  review_id: string;
  execution_id: string;
  persona_id: string;
  project_id: string | null;
  payload: unknown;
  status: string;
  created_at: number | null;
  resolved_at: number | null;
  response_message: string | null;
}

export const cloudListPendingReviews = () =>
  invoke<CloudReviewRequest[]>("cloud_list_pending_reviews");

export const cloudRespondToReview = (executionId: string, reviewId: string, decision: string, message: string) =>
  invoke<unknown>("cloud_respond_to_review", { executionId, reviewId, decision, message });

// Execution History & Stats

export interface CloudExecution {
  id: string;
  persona_id: string;
  project_id: string | null;
  status: string;
  input_data: string | null;
  error_message: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  retry_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CloudExecutionStats {
  total_executions: number;
  completed: number;
  failed: number;
  cancelled: number;
  success_rate: number | null;
  total_cost_usd: number;
  avg_cost_usd: number | null;
  avg_duration_ms: number | null;
  daily_breakdown: Array<{ date: string; count: number; cost: number; success_rate: number | null }>;
  top_errors: Array<{ message: string; count: number }>;
}

export const cloudListExecutions = (personaId?: string, status?: string, limit?: number, offset?: number) =>
  invoke<CloudExecution[]>("cloud_list_executions", {
    personaId: personaId ?? null,
    status: status ?? null,
    limit: limit ?? null,
    offset: offset ?? null,
  });

export const cloudExecutionStats = (personaId?: string, periodDays?: number) =>
  invoke<CloudExecutionStats>("cloud_execution_stats", {
    personaId: personaId ?? null,
    periodDays: periodDays ?? null,
  });

// Cloud Triggers (schedules, webhooks, etc.)

export interface CloudTrigger {
  id: string;
  project_id: string;
  persona_id: string;
  trigger_type: string;
  config: string | null;
  enabled: boolean;
  last_triggered_at: string | null;
  next_trigger_at: string | null;
  health_status: string | null;
  health_message: string | null;
  use_case_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CloudTriggerFiring {
  id: string;
  trigger_id: string;
  persona_id: string | null;
  execution_id: string | null;
  status: string;
  cost_usd: number | null;
  duration_ms: number | null;
  fired_at: string | null;
  resolved_at: string | null;
}

export const cloudListTriggers = (personaId: string) =>
  invoke<CloudTrigger[]>("cloud_list_triggers", { personaId });

export const cloudCreateTrigger = (
  personaId: string,
  triggerType: string,
  config?: string,
  enabled?: boolean,
  useCaseId?: string,
) =>
  invoke<CloudTrigger>("cloud_create_trigger", {
    personaId,
    triggerType,
    config: config ?? null,
    enabled: enabled ?? null,
    useCaseId: useCaseId ?? null,
  });

export const cloudUpdateTrigger = (
  triggerId: string,
  triggerType?: string,
  config?: string,
  enabled?: boolean,
) =>
  invoke<CloudTrigger>("cloud_update_trigger", {
    triggerId,
    triggerType: triggerType ?? null,
    config: config ?? null,
    enabled: enabled ?? null,
  });

export const cloudDeleteTrigger = (triggerId: string) =>
  invoke<void>("cloud_delete_trigger", { triggerId });

export const cloudListTriggerFirings = (triggerId: string, limit?: number) =>
  invoke<CloudTriggerFiring[]>("cloud_list_trigger_firings", {
    triggerId,
    limit: limit ?? null,
  });

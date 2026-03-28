import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CloudConfig } from "@/lib/bindings/CloudConfig";
import type { CloudStatusResponse } from "@/lib/bindings/CloudStatusResponse";
import type { CloudOAuthAuthorizeResponse } from "@/lib/bindings/CloudOAuthAuthorizeResponse";
import type { CloudOAuthStatusResponse } from "@/lib/bindings/CloudOAuthStatusResponse";
import type { CloudDeployment } from "@/lib/bindings/CloudDeployment";
import type { CloudReviewRequest } from "@/lib/bindings/CloudReviewRequest";
import type { CloudExecution } from "@/lib/bindings/CloudExecution";
import type { CloudExecutionStats } from "@/lib/bindings/CloudExecutionStats";
import type { CloudTrigger } from "@/lib/bindings/CloudTrigger";
import type { CloudTriggerFiring } from "@/lib/bindings/CloudTriggerFiring";
import type { CloudDiagnostics } from "@/lib/bindings/CloudDiagnostics";

export type { CloudConfig } from "@/lib/bindings/CloudConfig";
export type { CloudWorkerCounts } from "@/lib/bindings/CloudWorkerCounts";
export type { CloudStatusResponse } from "@/lib/bindings/CloudStatusResponse";
export type { CloudOAuthAuthorizeResponse } from "@/lib/bindings/CloudOAuthAuthorizeResponse";
export type { CloudOAuthStatusResponse } from "@/lib/bindings/CloudOAuthStatusResponse";
export type { CloudDiagnostics } from "@/lib/bindings/CloudDiagnostics";
export type { DiagnosticStep } from "@/lib/bindings/DiagnosticStep";
export type { CloudDeployment, CloudReviewRequest, CloudExecution, CloudExecutionStats, CloudTrigger, CloudTriggerFiring };

// Config
/** Returns health-check round-trip latency in milliseconds. */
export const cloudConnect = (url: string, apiKey: string) =>
  invoke<number>("cloud_connect", { url, apiKey });

export const cloudDiagnose = (url: string, apiKey: string) =>
  invoke<CloudDiagnostics>("cloud_diagnose", { url, apiKey });

/** Returns health-check round-trip latency in milliseconds. */
export const cloudReconnectFromKeyring = () =>
  invoke<number>("cloud_reconnect_from_keyring");

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

export const cloudDeployPersona = (personaId: string, maxMonthlyBudgetUsd?: number) =>
  invoke<CloudDeployment>("cloud_deploy_persona", { personaId, maxMonthlyBudgetUsd: maxMonthlyBudgetUsd });

export const cloudSyncPersona = (personaId: string) =>
  invoke<void>("cloud_sync_persona", { personaId });

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

export const cloudListPendingReviews = () =>
  invoke<CloudReviewRequest[]>("cloud_list_pending_reviews");

export const cloudRespondToReview = (executionId: string, reviewId: string, decision: string, message: string) =>
  invoke<unknown>("cloud_respond_to_review", { executionId, reviewId, decision, message });

// Execution History & Stats

export const cloudListExecutions = (personaId?: string, status?: string, limit?: number, offset?: number) =>
  invoke<CloudExecution[]>("cloud_list_executions", {
    personaId: personaId,
    status: status,
    limit: limit,
    offset: offset,
  });

export const cloudExecutionStats = (personaId?: string, periodDays?: number) =>
  invoke<CloudExecutionStats>("cloud_execution_stats", {
    personaId: personaId,
    periodDays: periodDays,
  });

export const cloudGetExecutionOutput = (executionId: string) =>
  invoke<string[]>("cloud_get_execution_output", { executionId });

// Cloud Triggers (schedules, webhooks, etc.)

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
    config: config,
    enabled: enabled,
    useCaseId: useCaseId,
  });

export const cloudUpdateTrigger = (
  triggerId: string,
  triggerType?: string,
  config?: string,
  enabled?: boolean,
) =>
  invoke<CloudTrigger>("cloud_update_trigger", {
    triggerId,
    triggerType: triggerType,
    config: config,
    enabled: enabled,
  });

export const cloudDeleteTrigger = (triggerId: string) =>
  invoke<void>("cloud_delete_trigger", { triggerId });

export const cloudListTriggerFirings = (triggerId: string, limit?: number) =>
  invoke<CloudTriggerFiring[]>("cloud_list_trigger_firings", {
    triggerId,
    limit: limit,
  });

// ============================================================================
// Cloud Webhook Relay
// ============================================================================

export interface CloudWebhookRelayStatus {
  connected: boolean;
  last_poll_at: string | null;
  active_webhook_triggers: number;
  total_relayed: number;
  error: string | null;
}

export const cloudWebhookRelayStatus = () =>
  invoke<CloudWebhookRelayStatus>("cloud_webhook_relay_status");

// ============================================================================
// Smee Relay Management
// ============================================================================

export interface SmeeRelay {
  id: string;
  label: string;
  channelUrl: string;
  status: 'active' | 'paused' | 'error';
  eventFilter: string | null;
  targetPersonaId: string | null;
  eventsRelayed: number;
  lastEventAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSmeeRelayInput {
  label: string;
  channelUrl: string;
  eventFilter?: string | null;
  targetPersonaId?: string | null;
}

export interface UpdateSmeeRelayInput {
  label?: string;
  eventFilter?: string | null;
  targetPersonaId?: string | null;
}

export const smeeRelayList = () =>
  invoke<SmeeRelay[]>("smee_relay_list");

export const smeeRelayCreate = (input: CreateSmeeRelayInput) =>
  invoke<SmeeRelay>("smee_relay_create", { input });

export const smeeRelayUpdate = (id: string, input: UpdateSmeeRelayInput) =>
  invoke<SmeeRelay>("smee_relay_update", { id, input });

export const smeeRelaySetStatus = (id: string, status: 'active' | 'paused') =>
  invoke<SmeeRelay>("smee_relay_set_status", { id, status });

export const smeeRelayDelete = (id: string) =>
  invoke<void>("smee_relay_delete", { id });

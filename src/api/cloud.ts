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
  created_at: string;
  updated_at: string;
}

export const cloudDeployPersona = (personaId: string) =>
  invoke<CloudDeployment>("cloud_deploy_persona", { personaId });

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

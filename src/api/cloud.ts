import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Cloud
// ============================================================================

export interface CloudConfig {
  url: string;
  is_connected: boolean;
}

export interface CloudWorkerCounts {
  idle: number;
  executing: number;
  disconnected: number;
}

export interface CloudOAuthState {
  connected: boolean;
  scopes: string[] | null;
  expiresAt: string | null;
}

export interface CloudStatusResult {
  workerCounts: CloudWorkerCounts;
  queueLength: number;
  activeExecutions: number;
  hasClaudeToken: boolean;
  oauth: CloudOAuthState | null;
}

export interface OAuthAuthorizeResult {
  authUrl: string;
  state: string;
  instructions: string | null;
}

export interface OAuthStatusResult {
  connected: boolean;
  scopes: string[] | null;
  expiresAt: string | null;
  isExpired: boolean | null;
}

// Config
export const cloudConnect = (url: string, apiKey: string) =>
  invoke<void>("cloud_connect", { url, apiKey });

export const cloudDisconnect = () =>
  invoke<void>("cloud_disconnect");

export const cloudGetConfig = () =>
  invoke<CloudConfig | null>("cloud_get_config");

// Status
export const cloudStatus = () =>
  invoke<CloudStatusResult>("cloud_status");

// Execution
export const cloudExecutePersona = (personaId: string, inputData?: string) =>
  invoke<string>("cloud_execute_persona", { personaId, inputData });

export const cloudCancelExecution = (executionId: string) =>
  invoke<boolean>("cloud_cancel_execution", { executionId });

// OAuth
export const cloudOAuthAuthorize = () =>
  invoke<OAuthAuthorizeResult>("cloud_oauth_authorize");

export const cloudOAuthCallback = (code: string, oauthState: string) =>
  invoke<unknown>("cloud_oauth_callback", { code, oauthState });

export const cloudOAuthStatus = () =>
  invoke<OAuthStatusResult>("cloud_oauth_status");

export const cloudOAuthRefresh = () =>
  invoke<unknown>("cloud_oauth_refresh");

export const cloudOAuthDisconnect = () =>
  invoke<void>("cloud_oauth_disconnect");

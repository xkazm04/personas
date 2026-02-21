import { invoke } from "@tauri-apps/api/core";

import type { CloudConfig } from "@/lib/bindings/CloudConfig";
import type { CloudStatusResponse } from "@/lib/bindings/CloudStatusResponse";
import type { CloudOAuthAuthorizeResponse } from "@/lib/bindings/CloudOAuthAuthorizeResponse";
import type { CloudOAuthStatusResponse } from "@/lib/bindings/CloudOAuthStatusResponse";

export type { CloudConfig } from "@/lib/bindings/CloudConfig";
export type { CloudWorkerCounts } from "@/lib/bindings/CloudWorkerCounts";
export type { CloudOAuthState } from "@/lib/bindings/CloudOAuthState";
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

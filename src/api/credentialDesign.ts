import { invoke } from "@tauri-apps/api/core";

import type { DesignStartResult } from "./design";

// ============================================================================
// Credential Design
// ============================================================================

export const startCredentialDesign = (instruction: string) =>
  invoke<DesignStartResult>("start_credential_design", { instruction });

export const cancelCredentialDesign = () =>
  invoke<void>("cancel_credential_design");

export interface CredentialDesignHealthcheckResult {
  success: boolean;
  message: string;
  healthcheck_config: Record<string, unknown> | null;
}

export const testCredentialDesignHealthcheck = (
  instruction: string,
  connector: Record<string, unknown>,
  fieldValues: Record<string, string>,
) =>
  invoke<CredentialDesignHealthcheckResult>("test_credential_design_healthcheck", {
    instruction,
    connector,
    fieldValues,
  });

export interface GoogleCredentialOAuthStartResult {
  session_id: string;
  auth_url: string;
  redirect_uri: string;
  credential_source?: 'app_managed' | 'user_provided';
}

export interface GoogleCredentialOAuthStatusResult {
  status: 'pending' | 'success' | 'error' | 'not_found';
  refresh_token: string | null;
  access_token: string | null;
  scope: string | null;
  error: string | null;
}

export const startGoogleCredentialOAuth = (
  clientId: string | undefined,
  clientSecret: string | undefined,
  connectorName: string,
  extraScopes?: string[],
) => {
  return invoke<GoogleCredentialOAuthStartResult>("start_google_credential_oauth", {
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
    connectorName,
    extraScopes: extraScopes ?? null,
  });
};

export const getGoogleCredentialOAuthStatus = (sessionId: string) =>
  invoke<GoogleCredentialOAuthStatusResult>("get_google_credential_oauth_status", {
    sessionId,
  });

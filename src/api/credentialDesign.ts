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

// ============================================================================
// Universal OAuth Gateway
// ============================================================================

export interface OAuthProvider {
  id: string;
  name: string;
  supports_pkce: boolean;
  default_scopes: string[];
}

export interface OAuthProviderListResult {
  providers: OAuthProvider[];
}

export interface OAuthStartResult {
  session_id: string;
  auth_url: string;
  redirect_uri: string;
  provider_id: string;
  pkce_used: boolean;
}

export interface OAuthStatusResult {
  status: 'pending' | 'success' | 'error' | 'not_found';
  provider_id?: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expires_in: number | null;
  extra: Record<string, unknown> | null;
  error: string | null;
}

export interface OAuthRefreshResult {
  access_token: string | null;
  refresh_token: string | null;
  expires_in: number | null;
  token_type: string | null;
  scope: string | null;
}

export const listOAuthProviders = () =>
  invoke<OAuthProviderListResult>("list_oauth_providers");

export interface StartOAuthParams {
  providerId: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  authorizeUrl?: string;
  tokenUrl?: string;
  oidcIssuer?: string;
  usePkce?: boolean;
  extraParams?: Record<string, string>;
}

export const startOAuth = (params: StartOAuthParams) =>
  invoke<OAuthStartResult>("start_oauth", {
    providerId: params.providerId,
    clientId: params.clientId,
    clientSecret: params.clientSecret ?? null,
    scopes: params.scopes ?? null,
    authorizeUrl: params.authorizeUrl ?? null,
    tokenUrl: params.tokenUrl ?? null,
    oidcIssuer: params.oidcIssuer ?? null,
    usePkce: params.usePkce ?? null,
    extraParams: params.extraParams ?? null,
  });

export const getOAuthStatus = (sessionId: string) =>
  invoke<OAuthStatusResult>("get_oauth_status", { sessionId });

export const refreshOAuthToken = (params: {
  providerId: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  tokenUrl?: string;
  oidcIssuer?: string;
}) =>
  invoke<OAuthRefreshResult>("refresh_oauth_token", {
    providerId: params.providerId,
    clientId: params.clientId,
    clientSecret: params.clientSecret ?? null,
    refreshToken: params.refreshToken,
    tokenUrl: params.tokenUrl ?? null,
    oidcIssuer: params.oidcIssuer ?? null,
  });

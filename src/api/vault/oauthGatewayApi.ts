import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { GoogleCredentialOAuthStartResult } from "@/lib/bindings/GoogleCredentialOAuthStartResult";
import type { GoogleCredentialOAuthStatusResult } from "@/lib/bindings/GoogleCredentialOAuthStatusResult";
import type { OAuthProvider } from "@/lib/bindings/OAuthProvider";
import type { OAuthProviderListResult } from "@/lib/bindings/OAuthProviderListResult";
import type { OAuthStartResult } from "@/lib/bindings/OAuthStartResult";
import type { OAuthStatusResult } from "@/lib/bindings/OAuthStatusResult";
import type { OAuthRefreshResult } from "@/lib/bindings/OAuthRefreshResult";
import type { StartOAuthParams } from "@/lib/bindings/StartOAuthParams";
export type { GoogleCredentialOAuthStartResult, GoogleCredentialOAuthStatusResult, OAuthProvider, OAuthProviderListResult, OAuthStartResult, OAuthStatusResult, OAuthRefreshResult, StartOAuthParams };

// ============================================================================
// Google OAuth
// ============================================================================

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
    extraScopes: extraScopes,
  });
};

export const getGoogleCredentialOAuthStatus = (sessionId: string) =>
  invoke<GoogleCredentialOAuthStatusResult>("get_google_credential_oauth_status", {
    sessionId,
  });

// ============================================================================
// Universal OAuth Gateway
// ============================================================================

export const listOAuthProviders = () =>
  invoke<OAuthProviderListResult>("list_oauth_providers");

export const startOAuth = (params: StartOAuthParams) =>
  invoke<OAuthStartResult>("start_oauth", {
    providerId: params.providerId,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    scopes: params.scopes,
    authorizeUrl: params.authorizeUrl,
    tokenUrl: params.tokenUrl,
    oidcIssuer: params.oidcIssuer,
    usePkce: params.usePkce,
    extraParams: params.extraParams,
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
    clientSecret: params.clientSecret,
    refreshToken: params.refreshToken,
    tokenUrl: params.tokenUrl,
    oidcIssuer: params.oidcIssuer,
  });

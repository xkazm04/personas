import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { GoogleCredentialOAuthStartResult } from "@/lib/bindings/GoogleCredentialOAuthStartResult";
import type { GoogleCredentialOAuthStatusResult } from "@/lib/bindings/GoogleCredentialOAuthStatusResult";
import type { OAuthProvider } from "@/lib/bindings/OAuthProvider";
import type { OAuthProviderListResult } from "@/lib/bindings/OAuthProviderListResult";
import type { OAuthStartResult } from "@/lib/bindings/OAuthStartResult";
import type { OAuthStatusResult } from "@/lib/bindings/OAuthStatusResult";
import type { StartOAuthParams } from "@/lib/bindings/StartOAuthParams";
export type { GoogleCredentialOAuthStartResult, GoogleCredentialOAuthStatusResult, OAuthProvider, OAuthProviderListResult, OAuthStartResult, OAuthStatusResult, StartOAuthParams };

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

// NOTE(token-hygiene 2026-07-16): refreshOAuthToken / the refresh_oauth_token
// command were retired — the command was the only OAuth IPC surface that
// accepted a raw refresh_token (and returned raw tokens), and it had no caller.
// OAuth token refresh happens entirely server-side in the runtime credential
// path (engine/runner). If a UI-driven refresh is ever needed, add a
// credential-id-based command that loads the token backend-side.

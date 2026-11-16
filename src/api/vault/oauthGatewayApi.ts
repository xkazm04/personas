import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { GoogleCredentialOAuthStartResult } from "@/lib/bindings/GoogleCredentialOAuthStartResult";
import type { OAuthStartResult } from "@/lib/bindings/OAuthStartResult";
import type { OAuthStatusResult } from "@/lib/bindings/OAuthStatusResult";
import type { StartOAuthParams } from "@/lib/bindings/StartOAuthParams";
export type { GoogleCredentialOAuthStartResult, OAuthStartResult, OAuthStatusResult, StartOAuthParams };

// ============================================================================
// Google OAuth
// ============================================================================

export const startGoogleCredentialOAuth = (
  clientId: string | undefined,
  clientSecret: string | undefined,
  connectorName: string,
  extraScopes?: string[],
  /**
   * Re-auth of an EXISTING credential rather than a fresh connect. The backend
   * adds a `login_hint` for the account recorded on that credential's ledger
   * and, at save, refuses a session that redeemed a different account (error
   * prefixed `oauth_account_mismatch:`, old token kept, `needs_reauth` stays
   * set). Omit it for a first-time connect, where no account is bound yet.
   */
  reconnectCredentialId?: string,
) => {
  return invoke<GoogleCredentialOAuthStartResult>("start_google_credential_oauth", {
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
    connectorName,
    extraScopes: extraScopes,
    reconnectCredentialId,
  });
};

// Both OAuth poll commands read the same server-side session table, so they
// share one payload type (`OAuthStatusResult`). The former
// `GoogleCredentialOAuthStatusResult` binding was an orphan — a hand-frozen
// copy of this same shape whose Rust source had been gone for some time.
export const getGoogleCredentialOAuthStatus = (sessionId: string) =>
  invoke<OAuthStatusResult>("get_google_credential_oauth_status", {
    sessionId,
  });

// ============================================================================
// Universal OAuth Gateway
// ============================================================================

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
// path (engine/runner). The UI-driven refresh is the credential-id-based
// `refreshCredentialOAuthNow` in ./rotation.ts (`refresh_credential_oauth_now`,
// src-tauri/src/commands/credentials/rotation.rs), which loads the token
// backend-side and audits the outcome; use it rather than adding another door.

import { useCallback } from 'react';
import { getGoogleCredentialOAuthStatus, startGoogleCredentialOAuth } from "@/api/vault/oauthGatewayApi";

import type { GoogleCredentialOAuthStatusResult } from "@/api/vault/oauthGatewayApi";

import { useOAuthProtocol } from '@/hooks/design/oauth/useOAuthProtocol';
import { OAUTH_FIELD } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';

export interface GoogleOAuthTokenData {
  /**
   * One-time reference to the completed server-side OAuth session. Submit it
   * as `oauthSessionRef` with create/update credential — the backend redeems
   * it into the real refresh token. Token material never crosses IPC.
   */
  oauth_session_ref: string;
  scope: string | null;
}

export interface GoogleOAuthState {
  isAuthorizing: boolean;
  completedAt: string | null;
  /** Status message from the OAuth polling flow */
  message: { success: boolean; message: string } | null;
  /** Read current OAuth values (stored in a ref to avoid DevTools exposure). */
  getValues: () => Record<string, string>;
  /** Monotonic counter incremented when values change. */
  valuesVersion: number;
  startConsent: (connectorName: string, extraScopes?: string[]) => void;
  reset: () => void;
}

interface UseGoogleOAuthOptions {
  onSuccess?: (data: GoogleOAuthTokenData) => void;
  onError?: (message: string) => void;
}

export function useGoogleOAuth(options: UseGoogleOAuthOptions = {}): GoogleOAuthState {
  const protocol = useOAuthProtocol<[string, string[] | undefined], GoogleCredentialOAuthStatusResult>({
    startFn: (connectorName, extraScopes) =>
      startGoogleCredentialOAuth(undefined, undefined, connectorName, extraScopes),
    pollFn: (sessionId) => getGoogleCredentialOAuthStatus(sessionId),
    extractValues: (poll, prev) => ({
      ...prev,
      [OAUTH_FIELD.SESSION_REF]: poll.oauth_session_ref ?? prev[OAUTH_FIELD.SESSION_REF] ?? '',
      scopes: poll.scope ?? prev.scopes ?? '',
    }),
    label: 'Google',
    startTimeoutMs: 0,
    onComplete: (values) => {
      options.onSuccess?.({
        oauth_session_ref: values[OAUTH_FIELD.SESSION_REF] ?? '',
        scope: values.scopes || null,
      });
    },
    onError: (msg) => {
      options.onError?.(msg);
    },
  });

  const startConsent = useCallback((connectorName: string, extraScopes?: string[]) => {
    protocol.start(connectorName, extraScopes);
  }, [protocol]);

  return {
    isAuthorizing: protocol.isActive,
    completedAt: protocol.completedAt,
    message: protocol.message,
    getValues: protocol.getValues,
    valuesVersion: protocol.valuesVersion,
    startConsent,
    reset: protocol.stop,
  };
}

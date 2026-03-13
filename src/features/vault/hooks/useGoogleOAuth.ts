import { useCallback } from 'react';
import { getGoogleCredentialOAuthStatus, startGoogleCredentialOAuth } from "@/api/vault/oauthGatewayApi";

import type { GoogleCredentialOAuthStatusResult } from "@/api/vault/oauthGatewayApi";

import { useOAuthProtocol } from '@/hooks/design/oauth/useOAuthProtocol';

export interface GoogleOAuthTokenData {
  refresh_token: string;
  scope: string | null;
  access_token: string | null;
}

export interface GoogleOAuthState {
  isAuthorizing: boolean;
  completedAt: string | null;
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
      refresh_token: poll.refresh_token ?? prev.refresh_token ?? '',
      scopes: poll.scope ?? prev.scopes ?? '',
    }),
    label: 'Google',
    startTimeoutMs: 0,
    onComplete: (values) => {
      options.onSuccess?.({
        refresh_token: values.refresh_token ?? '',
        scope: values.scopes || null,
        access_token: values.access_token || null,
      });
    },
    onError: (msg) => {
      options.onError?.(msg);
    },
  });

  const startConsent = useCallback((connectorName: string, extraScopes?: string[]) => {
    protocol.start(connectorName, extraScopes);
  }, [protocol.start]);

  return {
    isAuthorizing: protocol.isActive,
    completedAt: protocol.completedAt,
    getValues: protocol.getValues,
    valuesVersion: protocol.valuesVersion,
    startConsent,
    reset: protocol.stop,
  };
}

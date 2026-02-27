import { useEffect, useRef, useCallback } from 'react';
import * as api from '@/api/tauriApi';
import type { GoogleCredentialOAuthStatusResult } from '@/api/tauriApi';
import { useOAuthPolling } from '@/hooks/design/useOAuthPolling';

export interface GoogleOAuthTokenData {
  refresh_token: string;
  scope: string | null;
  access_token: string | null;
}

export interface GoogleOAuthState {
  isAuthorizing: boolean;
  completedAt: string | null;
  initialValues: Record<string, string>;
  startConsent: (connectorName: string, extraScopes?: string[]) => void;
  reset: () => void;
}

interface UseGoogleOAuthOptions {
  onSuccess?: (data: GoogleOAuthTokenData) => void;
  onError?: (message: string) => void;
}

export function useGoogleOAuth(options: UseGoogleOAuthOptions = {}): GoogleOAuthState {
  const onSuccessRef = useRef(options.onSuccess);
  onSuccessRef.current = options.onSuccess;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const polling = useOAuthPolling<[string, string[] | undefined], GoogleCredentialOAuthStatusResult>({
    startFn: (connectorName, extraScopes) =>
      api.startGoogleCredentialOAuth(undefined, undefined, connectorName, extraScopes),
    pollFn: (sessionId) => api.getGoogleCredentialOAuthStatus(sessionId),
    extractValues: (poll, prev) => ({
      ...prev,
      refresh_token: poll.refresh_token ?? prev.refresh_token ?? '',
      scopes: poll.scope ?? prev.scopes ?? '',
    }),
    label: 'Google',
    startTimeoutMs: 0, // useGoogleOAuth didn't have a start timeout
  });

  // Bridge polling.message to onSuccess/onError callbacks
  const prevMessageRef = useRef(polling.message);
  useEffect(() => {
    const msg = polling.message;
    if (msg === prevMessageRef.current) return;
    prevMessageRef.current = msg;
    if (!msg) return;

    if (msg.success) {
      onSuccessRef.current?.({
        refresh_token: polling.initialValues.refresh_token ?? '',
        scope: polling.initialValues.scopes || null,
        access_token: polling.initialValues.access_token || null,
      });
    } else if (polling.completedAt === null && !polling.isAuthorizing) {
      // Only fire onError when the flow actually ended in failure
      onErrorRef.current?.(msg.message);
    }
  }, [polling.message, polling.initialValues, polling.completedAt, polling.isAuthorizing]);

  const startConsent = useCallback((connectorName: string, extraScopes?: string[]) => {
    polling.startConsent(connectorName, extraScopes);
  }, [polling.startConsent]);

  return {
    isAuthorizing: polling.isAuthorizing,
    completedAt: polling.completedAt,
    initialValues: polling.initialValues,
    startConsent,
    reset: polling.reset,
  };
}

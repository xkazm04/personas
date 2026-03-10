<<<<<<< HEAD
import { useCallback } from 'react';
import * as api from '@/api/tauriApi';
import type { GoogleCredentialOAuthStatusResult } from '@/api/tauriApi';
import { useOAuthProtocol } from '@/hooks/design/useOAuthProtocol';
=======
import { useEffect, useRef, useCallback } from 'react';
import * as api from '@/api/tauriApi';
import type { GoogleCredentialOAuthStatusResult } from '@/api/tauriApi';
import { useOAuthPolling } from '@/hooks/design/useOAuthPolling';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
<<<<<<< HEAD
  const protocol = useOAuthProtocol<[string, string[] | undefined], GoogleCredentialOAuthStatusResult>({
    startFn: (connectorName, extraScopes) =>
      api.startGoogleCredentialOAuth(undefined, undefined, connectorName, extraScopes),
    pollFn: (sessionId) => api.getGoogleCredentialOAuthStatus(sessionId),
    extractValues: (poll, prev) => ({
      ...prev,
      refresh_token: poll.refresh_token ?? prev.refresh_token ?? '',
      scopes: poll.scope ?? prev.scopes ?? '',
    }),
    label: 'Google',
    startTimeoutMs: 0,
    onComplete: (values) => {
      options.onSuccess?.({
=======
  const onSuccessRef = useRef(options.onSuccess);
  onSuccessRef.current = options.onSuccess;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  // Ref-based snapshot: extractValues writes here atomically at extraction time,
  // so the success effect always reads values consistent with the current poll
  // result regardless of React's state-update batching order.
  const successValuesRef = useRef<Record<string, string>>({});

  const polling = useOAuthPolling<[string, string[] | undefined], GoogleCredentialOAuthStatusResult>({
    startFn: (connectorName, extraScopes) =>
      api.startGoogleCredentialOAuth(undefined, undefined, connectorName, extraScopes),
    pollFn: (sessionId) => api.getGoogleCredentialOAuthStatus(sessionId),
    extractValues: (poll, prev) => {
      const values = {
        ...prev,
        refresh_token: poll.refresh_token ?? prev.refresh_token ?? '',
        scopes: poll.scope ?? prev.scopes ?? '',
      };
      // Snapshot at extraction time — this runs inside setInitialValues's
      // functional updater, in the same synchronous block as setMessage,
      // so the ref is guaranteed fresh before any effect fires.
      successValuesRef.current = values;
      return values;
    },
    label: 'Google',
    startTimeoutMs: 0, // useGoogleOAuth didn't have a start timeout
  });

  // Bridge polling.message to onSuccess/onError callbacks.
  // Read from successValuesRef (not polling.initialValues) to avoid the
  // desynchronization window between separate state updates.
  const prevMessageRef = useRef(polling.message);
  useEffect(() => {
    const msg = polling.message;
    if (msg === prevMessageRef.current) return;
    prevMessageRef.current = msg;
    if (!msg) return;

    if (msg.success) {
      const values = successValuesRef.current;
      onSuccessRef.current?.({
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        refresh_token: values.refresh_token ?? '',
        scope: values.scopes || null,
        access_token: values.access_token || null,
      });
<<<<<<< HEAD
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
=======
    } else if (polling.completedAt === null && !polling.isAuthorizing) {
      // Only fire onError when the flow actually ended in failure
      onErrorRef.current?.(msg.message);
    }
  }, [polling.message, polling.completedAt, polling.isAuthorizing]);

  const startConsent = useCallback((connectorName: string, extraScopes?: string[]) => {
    polling.startConsent(connectorName, extraScopes);
  }, [polling.startConsent]);

  return {
    isAuthorizing: polling.isAuthorizing,
    completedAt: polling.completedAt,
    getValues: polling.getValues,
    valuesVersion: polling.valuesVersion,
    startConsent,
    reset: polling.reset,
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  };
}

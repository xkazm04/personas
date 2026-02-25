import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '@/api/tauriApi';

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});

  // Use refs for callbacks to avoid re-triggering the poll effect
  const onSuccessRef = useRef(options.onSuccess);
  onSuccessRef.current = options.onSuccess;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  // Poll for OAuth session completion
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const status = await api.getGoogleCredentialOAuthStatus(sessionId);
        if (cancelled) return;

        if (status.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setSessionId(null);
        setIsAuthorizing(false);

        if (status.status === 'success' && status.refresh_token) {
          setInitialValues((prev) => ({
            ...prev,
            refresh_token: status.refresh_token!,
            scopes: status.scope || prev.scopes || '',
          }));
          setCompletedAt(new Date().toLocaleTimeString());
          onSuccessRef.current?.({
            refresh_token: status.refresh_token,
            scope: status.scope ?? null,
            access_token: status.access_token ?? null,
          });
          return;
        }

        onErrorRef.current?.(status.error || 'Google authorization failed. Please try again.');
      } catch (err) {
        if (cancelled) return;
        setSessionId(null);
        setIsAuthorizing(false);
        onErrorRef.current?.(err instanceof Error ? err.message : 'Failed to check OAuth status.');
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId]);

  const startConsent = useCallback((connectorName: string, extraScopes?: string[]) => {
    setIsAuthorizing(true);
    setCompletedAt(null);

    api.startGoogleCredentialOAuth(undefined, undefined, connectorName, extraScopes)
      .then(async (oauthStart) => {
        let opened = false;
        try {
          await api.openExternalUrl(oauthStart.auth_url);
          opened = true;
        } catch {
          // fallback below
        }

        if (!opened) {
          try {
            const popup = window.open(oauthStart.auth_url, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch {
            // no-op
          }
        }

        if (!opened) {
          throw new Error('Could not open Google consent page. Please allow popups or external browser open.');
        }

        setSessionId(oauthStart.session_id);
      })
      .catch((err) => {
        setSessionId(null);
        setIsAuthorizing(false);
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to start Google authorization.';
        onErrorRef.current?.(message);
      });
  }, []);

  const reset = useCallback(() => {
    setSessionId(null);
    setIsAuthorizing(false);
    setCompletedAt(null);
    setInitialValues({});
  }, []);

  return { isAuthorizing, completedAt, initialValues, startConsent, reset };
}

import { useState, useEffect, useCallback } from 'react';
import { startGoogleCredentialOAuth, getGoogleCredentialOAuthStatus, openExternalUrl } from '@/api/tauriApi';

export interface OAuthConsentState {
  /** Initial credential field values produced by the OAuth flow (refresh_token, scopes, etc.) */
  initialValues: Record<string, string>;
  /** Whether an OAuth authorization is in progress */
  isAuthorizing: boolean;
  /** Localized time string when consent was completed, or null */
  completedAt: string | null;
  /** Healthcheck-style message from the OAuth flow */
  message: { success: boolean; message: string } | null;
  /** Start the OAuth consent flow */
  startConsent: (connectorName: string, values: Record<string, string>) => void;
  /** Reset all OAuth state */
  reset: () => void;
}

export function useOAuthConsent(): OAuthConsentState {
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [scopeFromConsent, setScopeFromConsent] = useState<string | null>(null);
  const [message, setMessage] = useState<{ success: boolean; message: string } | null>(null);

  // Poll for OAuth session completion
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const status = await getGoogleCredentialOAuthStatus(sessionId);
        if (cancelled) return;

        if (status.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setSessionId(null);
        setIsAuthorizing(false);

        if (status.status === 'success' && status.refresh_token) {
          const nowIso = new Date().toISOString();
          const effectiveScope = status.scope ?? scopeFromConsent ?? '';

          setInitialValues((prev) => ({
            ...prev,
            refresh_token: status.refresh_token!,
            scopes: effectiveScope,
            oauth_scope: effectiveScope,
            oauth_completed_at: nowIso,
            oauth_client_mode: 'app_managed',
          }));
          setCompletedAt(new Date().toLocaleTimeString());
          setMessage({
            success: true,
            message: 'Google authorization completed. Refresh token was auto-filled.',
          });
          return;
        }

        setMessage({
          success: false,
          message: status.error || 'Google authorization failed. Please try again.',
        });
      } catch (err) {
        if (cancelled) return;
        setSessionId(null);
        setIsAuthorizing(false);
        setMessage({
          success: false,
          message: err instanceof Error ? err.message : 'Failed to check OAuth status.',
        });
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [sessionId, scopeFromConsent]);

  const startConsent = useCallback((connectorName: string, values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : undefined;
    setScopeFromConsent(extraScopes ? extraScopes.join(' ') : null);

    setIsAuthorizing(true);
    setCompletedAt(null);
    setMessage({
      success: false,
      message: 'Starting Google authorization (requesting OAuth session)...',
    });

    const startPromise = startGoogleCredentialOAuth(undefined, undefined, connectorName || 'google', extraScopes);
    const timeoutPromise = new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('OAuth session start timed out (no IPC response in 12s).'));
      }, 12000);
    });

    Promise.race([startPromise, timeoutPromise])
      .then(async (oauthStart) => {
        const resolved = oauthStart as { auth_url: string; session_id: string };
        let opened = false;
        if (!opened) {
          try {
            await openExternalUrl(resolved.auth_url);
            opened = true;
          } catch {
            // fallback below
          }
        }

        if (!opened) {
          try {
            const popup = window.open(resolved.auth_url, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch {
            // no-op
          }
        }

        if (!opened) {
          throw new Error('Could not open Google consent page. Please allow popups or external browser open.');
        }

        setMessage({
          success: false,
          message: 'Google consent page opened. Complete consent in browser; refresh token will be auto-filled.',
        });
        setSessionId(resolved.session_id);
      })
      .catch((err) => {
        setSessionId(null);
        setIsAuthorizing(false);
        const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
        setMessage({
          success: false,
          message: `Google authorization did not start: ${detail}`,
        });
      });
  }, []);

  const reset = useCallback(() => {
    setInitialValues({});
    setSessionId(null);
    setIsAuthorizing(false);
    setCompletedAt(null);
    setScopeFromConsent(null);
    setMessage(null);
  }, []);

  return {
    initialValues,
    isAuthorizing,
    completedAt,
    message,
    startConsent,
    reset,
  };
}

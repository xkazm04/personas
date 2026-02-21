import { useState, useEffect, useCallback } from 'react';
import {
  startOAuth,
  getOAuthStatus,
  openExternalUrl,
  type StartOAuthParams,
} from '@/api/tauriApi';

export interface UniversalOAuthState {
  /** Credential values produced by the OAuth flow (access_token, refresh_token, etc.) */
  initialValues: Record<string, string>;
  /** Whether an OAuth authorization is in progress */
  isAuthorizing: boolean;
  /** Localized time string when consent was completed, or null */
  completedAt: string | null;
  /** Which provider was used */
  providerId: string | null;
  /** Status message from the OAuth flow */
  message: { success: boolean; message: string } | null;
  /** Start a universal OAuth consent flow */
  startConsent: (params: StartOAuthParams) => void;
  /** Reset all OAuth state */
  reset: () => void;
}

export function useUniversalOAuth(): UniversalOAuthState {
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ success: boolean; message: string } | null>(null);

  // Poll for session completion
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const status = await getOAuthStatus(sessionId);
        if (cancelled) return;

        if (status.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setSessionId(null);
        setIsAuthorizing(false);

        if (status.status === 'success') {
          const values: Record<string, string> = {};
          if (status.access_token) values.access_token = status.access_token;
          if (status.refresh_token) values.refresh_token = status.refresh_token;
          if (status.scope) {
            values.scopes = status.scope;
            values.oauth_scope = status.scope;
          }
          if (status.token_type) values.token_type = status.token_type;
          if (status.expires_in) values.expires_in = String(status.expires_in);
          values.oauth_completed_at = new Date().toISOString();
          values.oauth_provider = providerId ?? 'unknown';

          setInitialValues((prev) => ({ ...prev, ...values }));
          setCompletedAt(new Date().toLocaleTimeString());

          const label = providerId
            ? providerId.charAt(0).toUpperCase() + providerId.slice(1)
            : 'OAuth';
          setMessage({
            success: true,
            message: `${label} authorization completed. Tokens were auto-filled.`,
          });
          return;
        }

        setMessage({
          success: false,
          message: status.error || 'OAuth authorization failed. Please try again.',
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
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId, providerId]);

  const startConsent = useCallback((params: StartOAuthParams) => {
    setProviderId(params.providerId);
    setIsAuthorizing(true);
    setCompletedAt(null);

    const label = params.providerId.charAt(0).toUpperCase() + params.providerId.slice(1);
    setMessage({
      success: false,
      message: `Starting ${label} authorization...`,
    });

    const startPromise = startOAuth(params);
    const timeoutPromise = new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('OAuth session start timed out.'));
      }, 12000);
    });

    Promise.race([startPromise, timeoutPromise])
      .then(async (result) => {
        let opened = false;
        try {
          await openExternalUrl(result.auth_url);
          opened = true;
        } catch {
          // fallback
        }

        if (!opened) {
          try {
            const popup = window.open(result.auth_url, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch {
            // no-op
          }
        }

        if (!opened) {
          throw new Error('Could not open consent page. Please allow popups or external browser open.');
        }

        setMessage({
          success: false,
          message: `${label} consent page opened. Complete authorization in your browser.`,
        });
        setSessionId(result.session_id);
      })
      .catch((err) => {
        setSessionId(null);
        setIsAuthorizing(false);
        setMessage({
          success: false,
          message: err instanceof Error
            ? `${label} authorization did not start: ${err.message}`
            : `${label} authorization did not start.`,
        });
      });
  }, []);

  const reset = useCallback(() => {
    setInitialValues({});
    setSessionId(null);
    setIsAuthorizing(false);
    setCompletedAt(null);
    setProviderId(null);
    setMessage(null);
  }, []);

  return {
    initialValues,
    isAuthorizing,
    completedAt,
    providerId,
    message,
    startConsent,
    reset,
  };
}

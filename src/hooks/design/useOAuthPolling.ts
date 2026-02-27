import { useState, useEffect, useCallback, useRef } from 'react';
import { openExternalUrl } from '@/api/tauriApi';

/** Result returned by the generic start function. */
export interface OAuthStartResult {
  auth_url: string;
  session_id: string;
}

/** Minimum shape a poll result must satisfy. */
export interface OAuthPollResultBase {
  status: 'pending' | 'success' | 'error' | string;
  error?: string | null;
}

export interface OAuthPollingConfig<
  TStartArgs extends unknown[],
  TPollResult extends OAuthPollResultBase = OAuthPollResultBase & Record<string, unknown>,
> {
  /** Async function that initiates the OAuth flow. */
  startFn: (...args: TStartArgs) => Promise<OAuthStartResult>;
  /** Async function that checks the session status. */
  pollFn: (sessionId: string) => Promise<TPollResult>;
  /** Build credential field values from a successful poll result. */
  extractValues: (poll: TPollResult, prev: Record<string, string>) => Record<string, string>;
  /** Human-readable provider label (e.g. "Google", "GitHub"). */
  label: string;
  /** Timeout (ms) for the start call. 0 = no timeout. Default 12000. */
  startTimeoutMs?: number;
}

export interface OAuthPollingState<TStartArgs extends unknown[]> {
  initialValues: Record<string, string>;
  isAuthorizing: boolean;
  completedAt: string | null;
  message: { success: boolean; message: string } | null;
  startConsent: (...args: TStartArgs) => void;
  reset: () => void;
}

/**
 * Generic OAuth polling hook. Handles:
 * - Starting the OAuth flow and opening the consent URL
 * - Polling the session every 1500ms until success/error
 * - Managing isAuthorizing/completedAt/message/initialValues state
 * - Cleanup on unmount
 */
export function useOAuthPolling<
  TStartArgs extends unknown[],
  TPollResult extends OAuthPollResultBase = OAuthPollResultBase & Record<string, unknown>,
>(
  config: OAuthPollingConfig<TStartArgs, TPollResult>,
): OAuthPollingState<TStartArgs> {
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ success: boolean; message: string } | null>(null);

  // Stable refs so the poll effect doesn't re-trigger on config changes
  const configRef = useRef(config);
  configRef.current = config;

  // Poll for session completion
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const result = await configRef.current.pollFn(sessionId);
        if (cancelled) return;

        if (result.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setSessionId(null);
        setIsAuthorizing(false);

        if (result.status === 'success') {
          setInitialValues((prev) => configRef.current.extractValues(result, prev));
          setCompletedAt(new Date().toLocaleTimeString());
          setMessage({
            success: true,
            message: `${configRef.current.label} authorization completed.`,
          });
          return;
        }

        setMessage({
          success: false,
          message: result.error || `${configRef.current.label} authorization failed. Please try again.`,
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
  }, [sessionId]);

  const startConsent = useCallback((...args: TStartArgs) => {
    const { startFn, label, startTimeoutMs = 12000 } = configRef.current;

    setIsAuthorizing(true);
    setCompletedAt(null);
    setMessage({ success: false, message: `Starting ${label} authorization...` });

    const startPromise = startFn(...args);
    const withTimeout = startTimeoutMs > 0
      ? Promise.race([
          startPromise,
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('OAuth session start timed out.')), startTimeoutMs);
          }),
        ])
      : startPromise;

    withTimeout
      .then(async (oauthStart) => {
        let opened = false;
        try {
          await openExternalUrl(oauthStart.auth_url);
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
          throw new Error(`Could not open ${configRef.current.label} consent page. Please allow popups or external browser open.`);
        }

        setMessage({
          success: false,
          message: `${configRef.current.label} consent page opened. Complete authorization in your browser.`,
        });
        setSessionId(oauthStart.session_id);
      })
      .catch((err) => {
        setSessionId(null);
        setIsAuthorizing(false);
        const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
        setMessage({
          success: false,
          message: `${configRef.current.label} authorization did not start: ${detail}`,
        });
      });
  }, []);

  const reset = useCallback(() => {
    setInitialValues({});
    setSessionId(null);
    setIsAuthorizing(false);
    setCompletedAt(null);
    setMessage(null);
  }, []);

  return { initialValues, isAuthorizing, completedAt, message, startConsent, reset };
}

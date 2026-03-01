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
 *
 * Uses an AbortController to ensure only one polling loop runs per session.
 * Guards startConsent against concurrent re-entry via a ref.
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

  // Ref-based guard so the stable startConsent callback sees current authorizing state
  const isAuthorizingRef = useRef(false);

  // AbortController for the current polling loop — aborted when a new session
  // starts or on unmount so only one loop ever runs at a time.
  const abortRef = useRef<AbortController | null>(null);

  // Poll for session completion
  useEffect(() => {
    if (!sessionId) return;

    // Abort any previous polling loop before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let timer: number | null = null;

    const poll = async () => {
      if (controller.signal.aborted) return;

      try {
        const result = await configRef.current.pollFn(sessionId);
        if (controller.signal.aborted) return;

        if (result.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setSessionId(null);
        setIsAuthorizing(false);
        isAuthorizingRef.current = false;

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
        if (controller.signal.aborted) return;
        setSessionId(null);
        setIsAuthorizing(false);
        isAuthorizingRef.current = false;
        setMessage({
          success: false,
          message: err instanceof Error ? err.message : 'Failed to check OAuth status.',
        });
      }
    };

    poll();

    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId]);

  const startConsent = useCallback((...args: TStartArgs) => {
    // Prevent concurrent re-entry (e.g. double-click). The ref is used instead
    // of the state variable because this callback has stable identity ([] deps).
    if (isAuthorizingRef.current) return;
    isAuthorizingRef.current = true;

    const { startFn, label, startTimeoutMs = 12000 } = configRef.current;

    // Abort any existing poll from a previous session
    abortRef.current?.abort();

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
        isAuthorizingRef.current = false;
        const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
        setMessage({
          success: false,
          message: `${configRef.current.label} authorization did not start: ${detail}`,
        });
      });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    isAuthorizingRef.current = false;
    setInitialValues({});
    setSessionId(null);
    setIsAuthorizing(false);
    setCompletedAt(null);
    setMessage(null);
  }, []);

  return { initialValues, isAuthorizing, completedAt, message, startConsent, reset };
}

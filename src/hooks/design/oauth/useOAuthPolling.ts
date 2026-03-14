import { useState, useEffect, useCallback, useRef } from 'react';
import { openExternalUrl } from "@/api/system/system";
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';


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
  /** Read current credential values (stored in a ref to avoid DevTools/Sentry exposure). */
  getValues: () => Record<string, string>;
  /** Monotonic counter incremented when values change -- depend on this for re-renders. */
  valuesVersion: number;
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
  // Store credential values in a ref (not React state) to prevent exposure
  // via React DevTools, Sentry error serialization, and error boundaries.
  const valuesRef = useRef<Record<string, string>>({});
  const [valuesVersion, setValuesVersion] = useState(0);
  const getValues = useCallback(() => valuesRef.current, []);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ success: boolean; message: string } | null>(null);

  // Stable refs so the poll effect doesn't re-trigger on config changes
  const configRef = useRef(config);
  configRef.current = config;

  // Ref-based guard so the stable startConsent callback sees current authorizing state
  const isAuthorizingRef = useRef(false);

  // AbortController for the current polling loop -- aborted when a new session
  // starts or on unmount so only one loop ever runs at a time.
  const abortRef = useRef<AbortController | null>(null);
  const startTimeoutRef = useRef<number | null>(null);

  // Generation counter: incremented on every sessionId change. Poll callbacks
  // capture the current generation and discard results if it has since changed,
  // guarding against stale microtasks that survive AbortController.abort().
  const generationRef = useRef(0);

  const clearStartTimeout = useCallback(() => {
    if (startTimeoutRef.current !== null) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  }, []);

  // Poll for session completion
  useEffect(() => {
    if (!sessionId) return;

    // Abort any previous polling loop before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Capture generation so stale microtasks from a previous session are discarded
    const gen = ++generationRef.current;

    let timer: number | null = null;
    // 120 attempts × 1500ms = 3 minutes before giving up on a stuck session
    const MAX_POLL_ATTEMPTS = 120;
    let attempts = 0;

    const poll = async () => {
      if (controller.signal.aborted || gen !== generationRef.current) return;

      try {
        const result = await configRef.current.pollFn(sessionId);
        if (controller.signal.aborted || gen !== generationRef.current) return;

        if (result.status === 'pending') {
          attempts++;
          if (attempts >= MAX_POLL_ATTEMPTS) {
            setSessionId(null);
            setIsAuthorizing(false);
            isAuthorizingRef.current = false;
            setMessage({
              success: false,
              message: `${configRef.current.label} authorization timed out. Please try again.`,
            });
            return;
          }
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setSessionId(null);
        setIsAuthorizing(false);
        isAuthorizingRef.current = false;

        if (result.status === 'success') {
          valuesRef.current = configRef.current.extractValues(result, valuesRef.current);
          setValuesVersion((v) => v + 1);
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
        if (controller.signal.aborted || gen !== generationRef.current) return;
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

    // Abort any existing poll from a previous session and invalidate its generation
    abortRef.current?.abort();
    generationRef.current += 1;

    setIsAuthorizing(true);
    setCompletedAt(null);
    setMessage({ success: false, message: `Starting ${label} authorization...` });

    const startPromise = startFn(...args);
    const withTimeout = startTimeoutMs > 0
      ? Promise.race([
          startPromise,
          new Promise<never>((_, reject) => {
            clearStartTimeout();
            startTimeoutRef.current = window.setTimeout(() => reject(new Error('OAuth session start timed out.')), startTimeoutMs);
          }),
        ])
      : startPromise;

    withTimeout
      .then(async (oauthStart) => {
        clearStartTimeout();
        const safeAuthUrl = sanitizeExternalUrl(oauthStart.auth_url);
        if (!safeAuthUrl) {
          throw new Error(`Blocked unsafe ${configRef.current.label} authorization URL.`);
        }

        let opened = false;
        try {
          await openExternalUrl(safeAuthUrl);
          opened = true;
        } catch {
          // intentional: non-critical -- fallback to window.open below
        }

        if (!opened) {
          try {
            const popup = window.open(safeAuthUrl, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch {
            // intentional: non-critical -- both open methods failed, handled below
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
        clearStartTimeout();
        setSessionId(null);
        setIsAuthorizing(false);
        isAuthorizingRef.current = false;
        const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
        setMessage({
          success: false,
          message: `${configRef.current.label} authorization did not start: ${detail}`,
        });
      });
  }, [clearStartTimeout]);

  const reset = useCallback(() => {
    clearStartTimeout();
    abortRef.current?.abort();
    generationRef.current += 1;
    isAuthorizingRef.current = false;
    valuesRef.current = {};
    setValuesVersion((v) => v + 1);
    setSessionId(null);
    setIsAuthorizing(false);
    setCompletedAt(null);
    setMessage(null);
  }, [clearStartTimeout]);

  useEffect(() => {
    return () => {
      clearStartTimeout();
    };
  }, [clearStartTimeout]);

  return { getValues, valuesVersion, isAuthorizing, completedAt, message, startConsent, reset };
}

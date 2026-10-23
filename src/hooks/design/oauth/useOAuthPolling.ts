import { useState, useEffect, useCallback, useRef } from 'react';
import { openExternalUrl } from "@/api/system/system";
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import { getActiveTranslations, interpolate } from '@/i18n/useTranslation';
import { createLatestWins } from '@/stores/util/latestWins';


/**
 * Minimum shape the generic start function must return.
 *
 * Kept structural rather than importing the generated `OAuthStartResult`:
 * three different start commands feed this hook and they agree only on these
 * two fields. The names track the binding (camelCase), so a start result from
 * any of them satisfies it without a cast.
 */
export interface OAuthStartResult {
  authUrl: string;
  sessionId: string;
}

import type { OAuthSessionStatus } from '@/lib/bindings/OAuthSessionStatus';
import { extractMessage, silentCatch } from '@/lib/silentCatch';


/** Minimum shape a poll result must satisfy. */
export interface OAuthPollResultBase {
  status: OAuthSessionStatus;
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
  label: string | (() => string);
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
  const isDocumentVisible = useDocumentVisibility();

  // Stable refs so the poll effect doesn't re-trigger on config changes
  const configRef = useRef(config);
  configRef.current = config;
  const currentLabel = useCallback(() => {
    const label = configRef.current.label;
    return typeof label === 'function' ? label() : label;
  }, []);

  // Ref-based guard so the stable startConsent callback sees current authorizing state
  const isAuthorizingRef = useRef(false);

  // AbortController for the current polling loop -- aborted when a new session
  // starts or on unmount so only one loop ever runs at a time.
  const abortRef = useRef<AbortController | null>(null);
  const startTimeoutRef = useRef<number | null>(null);

  // Generation token: minted on every sessionId change and every start. Poll
  // callbacks capture the current token and discard results once a newer one
  // exists, guarding against stale microtasks that survive AbortController.abort().
  const generationRef = useRef(createLatestWins());

  const clearStartTimeout = useCallback(() => {
    if (startTimeoutRef.current !== null) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  }, []);

  // Poll for session completion
  useEffect(() => {
    if (!sessionId || !isDocumentVisible) return;

    // Abort any previous polling loop before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Capture generation so stale microtasks from a previous session are discarded
    const gen = generationRef.current.next();

    let timer: number | null = null;
    // 120 attempts × 1500ms = 3 minutes before giving up on a stuck session
    const MAX_POLL_ATTEMPTS = 120;
    let attempts = 0;

    const poll = async () => {
      if (controller.signal.aborted || !generationRef.current.isCurrent(gen)) return;

      try {
        const result = await configRef.current.pollFn(sessionId);
        if (controller.signal.aborted || !generationRef.current.isCurrent(gen)) return;

        if (result.status === 'pending') {
          attempts++;
          if (attempts >= MAX_POLL_ATTEMPTS) {
            setSessionId(null);
            setIsAuthorizing(false);
            isAuthorizingRef.current = false;
            setMessage({
              success: false,
              message: interpolate(getActiveTranslations().errors.oauth_timed_out, { provider: currentLabel() }),
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
            message: interpolate(getActiveTranslations().errors.oauth_completed, { provider: currentLabel() }),
          });
          return;
        }

        setMessage({
          success: false,
          message: result.error || interpolate(getActiveTranslations().errors.oauth_failed, { provider: currentLabel() }),
        });
      } catch (err) {
        if (controller.signal.aborted || !generationRef.current.isCurrent(gen)) return;
        setSessionId(null);
        setIsAuthorizing(false);
        isAuthorizingRef.current = false;
        setMessage({
          success: false,
          message: extractErrorDetail(err),
        });
      }
    };

    poll();

    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId, isDocumentVisible, currentLabel]);

  const startConsent = useCallback((...args: TStartArgs) => {
    // Prevent concurrent re-entry (e.g. double-click). The ref is used instead
    // of the state variable because this callback has stable identity ([] deps).
    if (isAuthorizingRef.current) return;
    isAuthorizingRef.current = true;

    const { startFn, startTimeoutMs = 12000 } = configRef.current;
    const label = currentLabel();

    // Abort any existing poll from a previous session and invalidate its generation
    abortRef.current?.abort();
    const startGen = generationRef.current.next();
    // reset() (or a newer session) bumps the generation; a start call that
    // settles after that must not open a consent page or touch state.
    const superseded = () => !generationRef.current.isCurrent(startGen);

    setIsAuthorizing(true);
    setCompletedAt(null);
    setMessage({ success: false, message: interpolate(getActiveTranslations().errors.oauth_starting, { provider: label }) });

    const startPromise = startFn(...args);
    const withTimeout = startTimeoutMs > 0
      ? Promise.race([
          startPromise,
          new Promise<never>((_, reject) => {
            clearStartTimeout();
            startTimeoutRef.current = window.setTimeout(() => reject(new Error(getActiveTranslations().errors.oauth_start_timeout)), startTimeoutMs);
          }),
        ])
      : startPromise;

    withTimeout
      .then(async (oauthStart) => {
        if (superseded()) return;
        clearStartTimeout();
        const safeAuthUrl = sanitizeExternalUrl(oauthStart.authUrl);
        if (!safeAuthUrl) {
          throw new Error(interpolate(getActiveTranslations().errors.oauth_unsafe_url, { provider: currentLabel() }));
        }

        let opened = false;
        try {
          await openExternalUrl(safeAuthUrl);
          opened = true;
        } catch (err) { silentCatch("hooks/design/oauth/useOAuthPolling:catch1")(err); }

        if (!opened) {
          try {
            const popup = window.open(safeAuthUrl, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch (err) { silentCatch("hooks/design/oauth/useOAuthPolling:catch2")(err); }
        }

        if (!opened) {
          throw new Error(interpolate(getActiveTranslations().errors.oauth_popup_blocked, { provider: currentLabel() }));
        }

        if (superseded()) return;
        setMessage({
          success: false,
          message: interpolate(getActiveTranslations().errors.oauth_consent_opened, { provider: currentLabel() }),
        });
        setSessionId(oauthStart.sessionId);
      })
      .catch((err) => {
        silentCatch("hooks/design/oauth/useOAuthPolling:catch3")(err);
        if (superseded()) return;
        clearStartTimeout();
        setSessionId(null);
        setIsAuthorizing(false);
        isAuthorizingRef.current = false;
        // Tauri serialises AppError as `{ error, kind }`, so a backend
        // rejection (e.g. "Google OAuth client credentials are missing
        // — set GCP_CLIENT_ID and GCP_CLIENT_SECRET …") lands here as
        // a plain object — neither Error nor string. Without unwrapping
        // we'd surface "unknown error" and hide the actionable hint.
        const detail = extractErrorDetail(err);
        setMessage({
          success: false,
          message: interpolate(getActiveTranslations().errors.oauth_not_started, { provider: currentLabel(), detail }),
        });
      });
  }, [clearStartTimeout, currentLabel]);

  const reset = useCallback(() => {
    clearStartTimeout();
    abortRef.current?.abort();
    generationRef.current.next();
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

/** A Tauri IPC rejection is the `{ error, kind }` AppError envelope, which
 *  `extractMessage` reads; an empty one falls back to the catalog's copy. */
function extractErrorDetail(err: unknown): string {
  return extractMessage(err) || getActiveTranslations().errors.oauth_unknown_error;
}

import { useEffect, useRef, useCallback } from 'react';
import {
  useOAuthPolling,
  type OAuthPollingConfig,
  type OAuthPollResultBase,
} from './useOAuthPolling';

/**
 * Callback-based OAuth protocol configuration.
 *
 * Extends the core OAuthPollingConfig with onComplete/onError callbacks,
 * eliminating the manual effect-based bridging that consumers like
 * useGoogleOAuth previously needed.
 */
export interface OAuthProtocolConfig<
  TStartArgs extends unknown[],
  TPollResult extends OAuthPollResultBase = OAuthPollResultBase & Record<string, unknown>,
> extends OAuthPollingConfig<TStartArgs, TPollResult> {
  /** Called when OAuth completes successfully. Values are stored in a ref (not state) for security. */
  onComplete?: (values: Record<string, string>) => void;
  /** Called when OAuth fails or times out. */
  onError?: (message: string) => void;
}

export interface OAuthProtocolState<TStartArgs extends unknown[]> {
  /** Start the OAuth consent flow. */
  start: (...args: TStartArgs) => void;
  /** Stop and reset the current flow. */
  stop: () => void;
  /** Whether an OAuth authorization is in progress. */
  isActive: boolean;
  /** Localized time string when consent was completed, or null. */
  completedAt: string | null;
  /** Status message from the OAuth flow. */
  message: { success: boolean; message: string } | null;
  /** Read current credential values (stored in a ref to avoid DevTools/Sentry exposure). */
  getValues: () => Record<string, string>;
  /** Monotonic counter incremented when values change — depend on this for re-renders. */
  valuesVersion: number;
}

/**
 * High-level OAuth protocol composable.
 *
 * Builds on useOAuthPolling's security-conscious core (generation counter for
 * stale microtask rejection, AbortController lifecycle, ref-based secret storage)
 * and adds callback-based completion handling.
 *
 * Exposes a simplified API: start/stop/onComplete instead of requiring consumers
 * to manually bridge state changes to callbacks via effects.
 */
export function useOAuthProtocol<
  TStartArgs extends unknown[],
  TPollResult extends OAuthPollResultBase = OAuthPollResultBase & Record<string, unknown>,
>(
  config: OAuthProtocolConfig<TStartArgs, TPollResult>,
): OAuthProtocolState<TStartArgs> {
  // Keep callbacks in refs so the effect doesn't re-trigger on config changes
  const onCompleteRef = useRef(config.onComplete);
  onCompleteRef.current = config.onComplete;
  const onErrorRef = useRef(config.onError);
  onErrorRef.current = config.onError;

  const polling = useOAuthPolling<TStartArgs, TPollResult>(config);

  // Bridge polling.message to onComplete/onError callbacks.
  // Uses a ref snapshot to avoid the desynchronization window between
  // separate state updates (same pattern useGoogleOAuth previously
  // implemented manually).
  const prevMessageRef = useRef(polling.message);
  useEffect(() => {
    const msg = polling.message;
    if (msg === prevMessageRef.current) return;
    prevMessageRef.current = msg;
    if (!msg) return;

    if (msg.success) {
      onCompleteRef.current?.(polling.getValues());
    } else if (polling.completedAt === null && !polling.isAuthorizing) {
      // Only fire onError when the flow actually ended in failure
      onErrorRef.current?.(msg.message);
    }
  }, [polling.message, polling.completedAt, polling.isAuthorizing, polling.getValues]);

  // Aliased API for clarity
  const start = useCallback((...args: TStartArgs) => {
    polling.startConsent(...args);
  }, [polling.startConsent]);

  return {
    start,
    stop: polling.reset,
    isActive: polling.isAuthorizing,
    completedAt: polling.completedAt,
    message: polling.message,
    getValues: polling.getValues,
    valuesVersion: polling.valuesVersion,
  };
}

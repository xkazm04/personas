import { useRef, useCallback } from 'react';
import * as api from '@/api/tauriApi';
import type { GoogleCredentialOAuthStatusResult } from '@/api/tauriApi';
import { useOAuthPolling } from './useOAuthPolling';
import { OAUTH_FIELD } from '@/features/vault/sub_design/CredentialDesignHelpers';

export interface OAuthConsentState {
  /** Read current credential values (stored in a ref to avoid DevTools/Sentry exposure). */
  getValues: () => Record<string, string>;
  /** Monotonic counter incremented when values change -- depend on this for re-renders. */
  valuesVersion: number;
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
  // Track the scope the user typed so extractValues can fall back to it
  const scopeRef = useRef<string | null>(null);

  const polling = useOAuthPolling<[string, string[] | undefined], GoogleCredentialOAuthStatusResult>({
    startFn: (connectorName, extraScopes) =>
      api.startGoogleCredentialOAuth(undefined, undefined, connectorName, extraScopes),
    pollFn: (sessionId) => api.getGoogleCredentialOAuthStatus(sessionId),
    extractValues: (poll, prev) => {
      const effectiveScope = poll.scope ?? scopeRef.current ?? '';
      return {
        ...prev,
        refresh_token: poll.refresh_token ?? prev.refresh_token ?? '',
        scopes: effectiveScope,
        [OAUTH_FIELD.SCOPE]: effectiveScope,
        [OAUTH_FIELD.COMPLETED_AT]: new Date().toISOString(),
        [OAUTH_FIELD.CLIENT_MODE]: 'app_managed',
      };
    },
    label: 'Google',
  });

  const startConsent = useCallback(
    (connectorName: string, values: Record<string, string>) => {
      const extraScopes = values.scopes?.trim()
        ? values.scopes.trim().split(/\s+/)
        : undefined;
      scopeRef.current = extraScopes ? extraScopes.join(' ') : null;
      polling.startConsent(connectorName || 'google', extraScopes);
    },
    [polling.startConsent],
  );

  return {
    getValues: polling.getValues,
    valuesVersion: polling.valuesVersion,
    isAuthorizing: polling.isAuthorizing,
    completedAt: polling.completedAt,
    message: polling.message,
    startConsent,
    reset: polling.reset,
  };
}

import { useState, useRef, useCallback } from 'react';
import {
  startOAuth,
  getOAuthStatus,
  type StartOAuthParams,
  type OAuthStatusResult,
} from '@/api/tauriApi';
import { useOAuthPolling } from './useOAuthPolling';
import { OAUTH_FIELD } from '@/features/vault/components/credential-design/CredentialDesignHelpers';

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
  const [providerId, setProviderId] = useState<string | null>(null);
  // Ref so extractValues and label can read the latest provider synchronously
  const providerRef = useRef<string | null>(null);

  const providerLabel = providerRef.current
    ? providerRef.current.charAt(0).toUpperCase() + providerRef.current.slice(1)
    : 'OAuth';

  const polling = useOAuthPolling<[StartOAuthParams], OAuthStatusResult>({
    startFn: (params) => startOAuth(params),
    pollFn: (sessionId) => getOAuthStatus(sessionId),
    extractValues: (poll, prev) => {
      const values: Record<string, string> = { ...prev };
      if (poll.access_token) values.access_token = poll.access_token;
      if (poll.refresh_token) values.refresh_token = poll.refresh_token;
      if (poll.scope) {
        values.scopes = poll.scope;
        values[OAUTH_FIELD.SCOPE] = poll.scope;
      }
      if (poll.token_type) values.token_type = poll.token_type;
      if (poll.expires_in) values.expires_in = String(poll.expires_in);
      values[OAUTH_FIELD.COMPLETED_AT] = new Date().toISOString();
      values[OAUTH_FIELD.PROVIDER] = providerRef.current ?? 'unknown';
      return values;
    },
    label: providerLabel,
  });

  const startConsent = useCallback(
    (params: StartOAuthParams) => {
      providerRef.current = params.providerId;
      setProviderId(params.providerId);
      polling.startConsent(params);
    },
    [polling.startConsent],
  );

  const resetAll = useCallback(() => {
    providerRef.current = null;
    setProviderId(null);
    polling.reset();
  }, [polling.reset]);

  return {
    initialValues: polling.initialValues,
    isAuthorizing: polling.isAuthorizing,
    completedAt: polling.completedAt,
    providerId,
    message: polling.message,
    startConsent,
    reset: resetAll,
  };
}

import { useCallback, useRef } from 'react';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { OAUTH_FIELD } from '@/features/vault/sub_design/CredentialDesignHelpers';

export interface CredentialOAuthResult {
  credentialData: Record<string, string>;
}

interface UseCredentialOAuthOptions {
  onSuccess: (result: CredentialOAuthResult) => Promise<void>;
  onError: (message: string) => void;
}

export interface CredentialOAuthState {
  isAuthorizing: boolean;
  completedAt: string | null;
  /** Status message from the OAuth polling flow */
  message: { success: boolean; message: string } | null;
  startConsent: (connectorName: string, values: Record<string, string>) => void;
  reset: () => void;
}

export function useCredentialOAuth({ onSuccess, onError }: UseCredentialOAuthOptions): CredentialOAuthState {
  // Store pending values (which may contain client_secret) in a ref to avoid
  // exposure via React DevTools, Sentry, and error boundary serialization.
  const pendingValuesRef = useRef<Record<string, string> | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const googleOAuth = useGoogleOAuth({
    onSuccess: (data) => {
      const pv = pendingValuesRef.current;
      if (!pv) {
        onErrorRef.current('OAuth finished but context was lost. Please retry.');
        return;
      }

      const nowIso = new Date().toISOString();
      const effectiveScopes = data.scope ?? pv.scopes?.trim() ?? '';
      const { client_id: _cid, client_secret: _csec, ...safePendingValues } = pv;
      void _cid; void _csec;

      const credentialData = {
        ...safePendingValues,
        refresh_token: data.refresh_token,
        scopes: effectiveScopes,
        [OAUTH_FIELD.SCOPE]: data.scope ?? effectiveScopes,
        [OAUTH_FIELD.COMPLETED_AT]: nowIso,
        [OAUTH_FIELD.CLIENT_MODE]: 'app_managed',
      };

      pendingValuesRef.current = null;
      onSuccessRef.current({ credentialData });
    },
    onError: (msg) => {
      // Clear pending values containing client_secret on error
      pendingValuesRef.current = null;
      onErrorRef.current(msg);
    },
  });

  const startConsent = useCallback((connectorName: string, values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : undefined;
    pendingValuesRef.current = values;
    googleOAuth.startConsent(connectorName, extraScopes);
  }, [googleOAuth.startConsent]);

  const reset = useCallback(() => {
    googleOAuth.reset();
    pendingValuesRef.current = null;
  }, [googleOAuth.reset]);

  return {
    isAuthorizing: googleOAuth.isAuthorizing,
    completedAt: googleOAuth.completedAt,
    message: googleOAuth.message,
    startConsent,
    reset,
  };
}

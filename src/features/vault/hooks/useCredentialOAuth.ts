import { useState, useCallback, useRef } from 'react';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { OAUTH_FIELD } from '@/features/vault/components/credential-design/CredentialDesignHelpers';

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
  startConsent: (connectorName: string, values: Record<string, string>) => void;
  reset: () => void;
}

export function useCredentialOAuth({ onSuccess, onError }: UseCredentialOAuthOptions): CredentialOAuthState {
  const [pendingValues, setPendingValues] = useState<Record<string, string> | null>(null);

  // Use refs so the callbacks passed to useGoogleOAuth don't cause re-renders
  const pendingValuesRef = useRef(pendingValues);
  pendingValuesRef.current = pendingValues;
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

      setPendingValues(null);
      onSuccessRef.current({ credentialData });
    },
    onError: (msg) => onErrorRef.current(msg),
  });

  const startConsent = useCallback((connectorName: string, values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : undefined;
    setPendingValues(values);
    googleOAuth.startConsent(connectorName, extraScopes);
  }, [googleOAuth.startConsent]);

  const reset = useCallback(() => {
    googleOAuth.reset();
    setPendingValues(null);
  }, [googleOAuth.reset]);

  return {
    isAuthorizing: googleOAuth.isAuthorizing,
    completedAt: googleOAuth.completedAt,
    startConsent,
    reset,
  };
}

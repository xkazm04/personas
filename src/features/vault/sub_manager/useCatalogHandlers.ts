import { useCallback, useEffect } from 'react';
import { useCredentialOAuth } from '@/features/vault/hooks/useCredentialOAuth';
import { useUniversalOAuth } from '@/hooks/design/oauth/useUniversalOAuth';
import { useCredentialHealth } from '@/features/vault/hooks/health/useCredentialHealth';
import { isUniversalOAuthConnector, getOAuthProviderId, getOAuthScopes } from '@/lib/utils/platform/connectors';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { CredentialViewState } from '@/features/vault/hooks/useCredentialViewFSM';
import type { CredentialViewAction } from '@/features/vault/hooks/useCredentialViewFSM';

interface CatalogFormData {
  connector: ConnectorDefinition;
  credentialName: string;
  fields: { key: string; label: string; placeholder?: string; secret?: boolean }[];
  isGoogle: boolean;
}

interface CatalogHandlersOptions {
  viewState: CredentialViewState;
  dispatch: React.Dispatch<CredentialViewAction>;
  catalogFormData: CatalogFormData | null;
  credentialSearch: string;
  setCredentialSearch: (v: string) => void;
  setError: (v: string | null) => void;
  createCredential: (input: { name: string; service_type: string; data: object }) => Promise<string>;
  fetchCredentials: () => Promise<void>;
}

export function useCatalogHandlers({
  viewState,
  dispatch,
  catalogFormData,
  credentialSearch,
  setCredentialSearch,
  setError,
  createCredential,
  fetchCredentials,
}: CatalogHandlersOptions) {
  // Healthcheck for catalog (from-template) flow
  const templateHealth = useCredentialHealth({
    mode: 'preview',
    serviceType: viewState.view === 'catalog-form' ? viewState.connector.name : null,
  });

  const handleOAuthSuccess = useCallback(async ({ credentialData }: { credentialData: Record<string, string> }) => {
    if (!catalogFormData) return;
    // Populate the form with OAuth tokens so the user can test and confirm before saving.
    dispatch({ type: 'SET_OAUTH_VALUES', values: credentialData });
  }, [catalogFormData, dispatch]);

  const handleOAuthError = useCallback((message: string) => {
    setError(message);
  }, [setError]);

  const oauth = useCredentialOAuth({
    onSuccess: handleOAuthSuccess,
    onError: handleOAuthError,
  });

  const universalOAuth = useUniversalOAuth();

  // Populate form with universal OAuth tokens for healthcheck/confirmation
  useEffect(() => {
    if (!universalOAuth.completedAt || !catalogFormData) return;
    const values = universalOAuth.getValues();
    if (!values.access_token) return;
    dispatch({ type: 'SET_OAUTH_VALUES', values });
  }, [universalOAuth.completedAt]);

  const handlePickType = useCallback((connector: ConnectorDefinition) => {
    oauth.reset();
    universalOAuth.reset();
    dispatch({ type: 'PICK_CONNECTOR', connector, parentSearch: credentialSearch });
  }, [credentialSearch, dispatch, oauth, universalOAuth]);

  const handleCreateCredential = async (values: Record<string, string>) => {
    if (!catalogFormData) return;
    const name = catalogFormData.credentialName.trim() || `${catalogFormData.connector.label} Credential`;
    setError(null);
    try {
      await createCredential({
        name,
        service_type: catalogFormData.connector.name,
        data: values,
      });
      await fetchCredentials();
      dispatch({ type: 'GO_LIST' });
      setCredentialSearch('');
    } catch {
      setError('Failed to create credential');
    }
  };

  const handleTemplateOAuthConsent = (values: Record<string, string>) => {
    if (!catalogFormData) return;
    setError(null);
    const connector = catalogFormData.connector;
    if (isUniversalOAuthConnector(connector)) {
      const providerId = getOAuthProviderId(connector) ?? 'custom';
      const scopes = getOAuthScopes(connector);
      universalOAuth.startConsent({
        providerId,
        clientId: values.client_id ?? '',
        clientSecret: values.client_secret,
        scopes: scopes.length > 0 ? scopes : undefined,
      });
    } else {
      oauth.startConsent(connector.name, values);
    }
  };

  const handleTemplateHealthcheck = async (values: Record<string, string>) => {
    if (!catalogFormData) return;
    await templateHealth.checkPreview(catalogFormData.connector.name, values);
  };

  const handleAutoSetup = useCallback(() => {
    if (!catalogFormData) return;
    dispatch({ type: 'GO_AUTO_SETUP', connector: catalogFormData.connector });
  }, [catalogFormData, dispatch]);

  const handleDesktopDetect = useCallback(() => {
    dispatch({ type: 'GO_ADD_DESKTOP' });
  }, [dispatch]);

  return {
    oauth,
    universalOAuth,
    templateHealth,
    handlePickType,
    handleCreateCredential,
    handleTemplateOAuthConsent,
    handleTemplateHealthcheck,
    handleAutoSetup,
    handleDesktopDetect,
  };
}

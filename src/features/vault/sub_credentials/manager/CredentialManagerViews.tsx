import { CredentialList } from '@/features/vault/sub_credentials/components/list/CredentialList';
import { CredentialPicker } from '@/features/vault/sub_catalog/components/picker/CredentialPicker';
import { CredentialTemplateForm } from '@/features/vault/sub_catalog/components/forms/CredentialTemplateForm';
import { CatalogAutoSetup } from '@/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup';
import { CredentialRelationshipGraph } from '@/features/vault/sub_dependencies/CredentialRelationshipGraph';
import { isUniversalOAuthConnector, isDesktopBridge } from '@/lib/utils/platform/connectors';
import { CredentialAddViews } from './CredentialAddViews';
import { silentCatch } from "@/lib/silentCatch";
import type { useCredentialManagerState } from './useCredentialManagerState';

type ManagerState = ReturnType<typeof useCredentialManagerState>;

interface CredentialManagerViewsProps {
  state: ManagerState;
}

export function CredentialManagerViews({ state }: CredentialManagerViewsProps) {
  const {
    viewState,
    dispatch,
    filteredConnectors,
    catalogFormData,
    credentials,
    connectorDefinitions,
    credentialSearch,
    setCredentialSearch,
    oauth,
    universalOAuth,
    templateHealth,
    handlePickType,
    handleCreateCredential,
    handleDeleteRequest,
    handleTemplateOAuthConsent,
    handleTemplateHealthcheck,
    handleAutoSetup,
    handleDesktopDetect,
    fetchCredentials,
    fetchConnectorDefinitions,
    IS_DESKTOP,
  } = state;

  return (
    <>
      {viewState.view === 'catalog-browse' && (
          <div className="animate-fade-slide-in"
            key="picker"
          >
            <CredentialPicker
              connectors={filteredConnectors}
              credentials={credentials}
              onPickType={handlePickType}
              searchTerm={credentialSearch}
            />
          </div>
        )}

        {viewState.view === 'catalog-form' && (
          <CredentialTemplateForm
            key="catalog-form"
            selectedConnector={viewState.connector}
            credentialName={viewState.credentialName}
            onCredentialNameChange={(name) => dispatch({ type: 'SET_CREDENTIAL_NAME', name })}
            effectiveTemplateFields={catalogFormData!.fields}
            isGoogleTemplate={catalogFormData!.isGoogle}
            isOAuthTemplate={isUniversalOAuthConnector(viewState.connector)}
            isAuthorizingOAuth={oauth.isAuthorizing || universalOAuth.isAuthorizing}
            oauthCompletedAt={oauth.completedAt ?? universalOAuth.completedAt}
            oauthPollingMessage={oauth.message ?? universalOAuth.message}
            oauthValues={viewState.oauthValues}
            onCreateCredential={handleCreateCredential}
            onOAuthConsent={handleTemplateOAuthConsent}
            onAutoSetup={handleAutoSetup}
            onDesktopDetect={isDesktopBridge(viewState.connector) ? handleDesktopDetect : undefined}
            onBack={() => {
              dispatch({ type: 'CANCEL_FORM' });
              oauth.reset();
              universalOAuth.reset();
              templateHealth.invalidate();
            }}
            onCancel={() => {
              dispatch({ type: 'CANCEL_FORM' });
              oauth.reset();
              universalOAuth.reset();
              templateHealth.invalidate();
            }}
            onValuesChanged={() => {
              if (oauth.completedAt) oauth.reset();
              if (universalOAuth.completedAt) universalOAuth.reset();
              if (templateHealth.result) templateHealth.invalidate();
            }}
            onMcpComplete={() => {
              void fetchCredentials().catch(silentCatch("CredentialManagerViews:fetchCredentialsOnMcpComplete"));
              fetchConnectorDefinitions();
              dispatch({ type: 'GO_LIST' });
            }}
            onHealthcheck={handleTemplateHealthcheck}
            isHealthchecking={templateHealth.isHealthchecking}
            healthcheckResult={templateHealth.result}
          />
        )}

        {viewState.view === 'catalog-auto-setup' && IS_DESKTOP && (
          <CatalogAutoSetup
            key="catalog-auto-setup"
            connector={viewState.connector}
            onComplete={() => {
              void fetchCredentials();
              fetchConnectorDefinitions();
              dispatch({ type: 'GO_LIST' });
              setCredentialSearch('');
            }}
            onCancel={() => dispatch({ type: 'CANCEL_FORM' })}
          />
        )}

        {viewState.view === 'list' && (
          <CredentialList
            key="list"
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            searchTerm={credentialSearch}
            onDelete={handleDeleteRequest}
            onGoToCatalog={() => dispatch({ type: 'GO_CATALOG' })}
            onGoToAddNew={() => dispatch({ type: 'GO_ADD_NEW' })}
            onWorkspaceConnect={() => dispatch({ type: 'GO_WORKSPACE_CONNECT' })}
            onQuickStart={(connector) => handlePickType(connector)}
          />
        )}
        {viewState.view === 'graph' && (
          <CredentialRelationshipGraph key="graph" />
        )}

      <CredentialAddViews state={state} />
    </>
  );
}

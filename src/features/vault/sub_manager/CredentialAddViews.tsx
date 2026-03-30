import { CredentialDesignModal } from '@/features/vault/sub_design/CredentialDesignModal';
import { CredentialTypePicker } from '@/features/vault/sub_forms/CredentialTypePicker';
import { CredentialSchemaForm, MCP_SCHEMA, CUSTOM_SCHEMA, DATABASE_SCHEMA } from '@/features/vault/sub_schemas/CredentialSchemaForm';
import { ForagingPanel } from '@/features/vault/sub_foraging/ForagingPanel';
import { DesktopDiscoveryPanel } from '@/features/vault/sub_desktop/DesktopDiscoveryPanel';
import { DatabaseListView } from '@/features/vault/sub_databases/DatabaseListView';
import { WorkspaceConnectPanel } from '@/features/vault/sub_workspace/WorkspaceConnectPanel';
import type { useCredentialManagerState } from './useCredentialManagerState';

type ManagerState = ReturnType<typeof useCredentialManagerState>;

interface CredentialAddViewsProps {
  state: ManagerState;
}

export function CredentialAddViews({ state }: CredentialAddViewsProps) {
  const {
    viewState,
    dispatch,
    setCredentialSearch,
    fetchCredentials,
    fetchConnectorDefinitions,
    IS_DESKTOP,
  } = state;

  return (
    <div data-testid="vault-add-views">
      {viewState.view === 'add-new' && (
        <CredentialTypePicker
          onSelectAiGuide={() => dispatch({ type: 'GO_ADD_AI_GUIDE' })}
          onSelectMcp={() => dispatch({ type: 'GO_ADD_MCP' })}
          onSelectCustom={() => dispatch({ type: 'GO_ADD_CUSTOM' })}
          onSelectDatabase={() => dispatch({ type: 'GO_ADD_DATABASE' })}
          onSelectDesktop={() => dispatch({ type: 'GO_ADD_DESKTOP' })}
          onWorkspaceConnect={() => dispatch({ type: 'GO_WORKSPACE_CONNECT' })}
          onForage={() => dispatch({ type: 'GO_FORAGING' })}
          onBack={() => dispatch({ type: 'GO_LIST' })}
        />
      )}

      {viewState.view === 'add-desktop' && IS_DESKTOP && (
        <DesktopDiscoveryPanel
          onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
          onCredentialCreated={() => {
            void fetchCredentials();
            fetchConnectorDefinitions();
          }}
        />
      )}


      {viewState.view === 'foraging' && IS_DESKTOP && (
        <ForagingPanel
          onComplete={() => {
            void fetchCredentials();
            fetchConnectorDefinitions();
            dispatch({ type: 'GO_LIST' });
          }}
          onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
        />
      )}

      {viewState.view === 'workspace-connect' && (
        <WorkspaceConnectPanel
          onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
          onComplete={() => {
            fetchConnectorDefinitions();
            dispatch({ type: 'GO_LIST' });
            setCredentialSearch('');
          }}
        />
      )}

      {viewState.view === 'add-ai-guide' && (
        <div
          key="design-inline"
          className="animate-fade-slide-in bg-secondary/35 border border-primary/15 rounded-xl p-4"
        >
          <CredentialDesignModal
            open
            embedded
            onClose={() => dispatch({ type: 'GO_ADD_NEW' })}
            onComplete={() => {
              fetchConnectorDefinitions();
              dispatch({ type: 'GO_LIST' });
            }}
          />
        </div>
      )}

      {viewState.view === 'add-mcp' && (
        <CredentialSchemaForm
          config={MCP_SCHEMA}
          onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
          onComplete={() => dispatch({ type: 'GO_LIST' })}
        />
      )}

      {viewState.view === 'add-custom' && (
        <CredentialSchemaForm
          config={CUSTOM_SCHEMA}
          onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
          onComplete={() => dispatch({ type: 'GO_LIST' })}
        />
      )}

      {viewState.view === 'add-database' && (
        <CredentialSchemaForm
          config={DATABASE_SCHEMA}
          onBack={() => dispatch({ type: 'GO_ADD_NEW' })}
          onComplete={() => dispatch({ type: 'GO_LIST' })}
        />
      )}


      {viewState.view === 'databases' && (
        <DatabaseListView onBack={() => dispatch({ type: 'GO_LIST' })} />
      )}
    </div>
  );
}

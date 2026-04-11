import { useTranslation } from '@/i18n/useTranslation';
import { TabTransition } from '@/features/templates/sub_generated/shared/TabTransition';
import { OverviewTab } from './tabs/OverviewTab';
import { ApiExplorerTab } from './tabs/ApiExplorerTab';
import { McpToolsTab } from './tabs/McpToolsTab';
import { CredentialRotationSection } from '@/features/vault/sub_credentials/components/features/CredentialRotationSection';
import { CredentialRecipesTab } from './tabs/CredentialRecipesTab';
import { ExecutionsTab } from './tabs/ExecutionsTab';
import { CATALOG_API_ENDPOINTS } from '@/lib/credentials/catalogApiEndpoints';
import type { RotationStatus } from '@/api/vault/rotation';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { GoogleOAuthState } from '@/features/vault/shared/hooks/useGoogleOAuth';

type PlaygroundTab = 'overview' | 'executions' | 'api-explorer' | 'recipes' | 'mcp-tools' | 'rotation';

interface PlaygroundTabContentProps {
  activeTab: PlaygroundTab;
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  isGoogleOAuthFlow: boolean;
  googleOAuth: GoogleOAuthState;
  effectiveHealthcheckResult: { success: boolean; message: string } | null;
  isHealthchecking: boolean;
  health: { checkStored: () => void; checkPreview: (serviceType: string, values: Record<string, string>) => void; result: { success: boolean; message: string } | null; isHealthchecking: boolean };
  rotationStatus: RotationStatus | null;
  rotationCountdown: string;
  fetchRotationStatus: () => Promise<void>;
  editError: string | null;
  setEditError: (err: string | null) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onDelete: (id: string) => void;
}

export function PlaygroundTabContent({
  activeTab,
  credential,
  connector,
  isGoogleOAuthFlow,
  googleOAuth,
  effectiveHealthcheckResult,
  isHealthchecking,
  health,
  rotationStatus,
  rotationCountdown,
  fetchRotationStatus,
  editError,
  setEditError,
  onOAuthConsent,
  onDelete,
}: PlaygroundTabContentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <TabTransition tabKey={activeTab}>
        {activeTab === 'overview' && connector && (
          <OverviewTab
            credential={credential}
            connector={connector}
            isGoogleOAuthFlow={isGoogleOAuthFlow}
            googleOAuth={googleOAuth}
            effectiveHealthcheckResult={effectiveHealthcheckResult}
            isHealthchecking={isHealthchecking}
            health={health}
            rotationStatus={rotationStatus}
            rotationCountdown={rotationCountdown}
            fetchRotationStatus={fetchRotationStatus}
            editError={editError}
            setEditError={setEditError}
            onOAuthConsent={onOAuthConsent}
            onDelete={onDelete}
          />
        )}
        {activeTab === 'overview' && !connector && (
          <div className="p-6 text-sm text-muted-foreground/80">
            {t.vault.shared.no_connector_available}
          </div>
        )}
        {activeTab === 'executions' && (
          <ExecutionsTab credentialId={credential.id} createdAt={credential.created_at} />
        )}
        {activeTab === 'api-explorer' && (
          <ApiExplorerTab
            credentialId={credential.id}
            catalogEndpoints={connector ? CATALOG_API_ENDPOINTS[connector.name] : undefined}
          />
        )}
        {activeTab === 'recipes' && (
          <CredentialRecipesTab credentialId={credential.id} />
        )}
        {activeTab === 'mcp-tools' && (
          <McpToolsTab credentialId={credential.id} />
        )}
        {activeTab === 'rotation' && (
          <div className="p-6">
            <CredentialRotationSection
              credentialId={credential.id}
              rotationStatus={rotationStatus}
              rotationCountdown={rotationCountdown}
              onRefresh={fetchRotationStatus}
              onHealthcheck={() => health.checkStored()}
            />
          </div>
        )}
      </TabTransition>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from '@/stores/vaultStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ConnectionStatusBadge } from '@/features/shared/components/feedback/ConnectionStatusBadge';
import { PanelTabBar } from '@/features/shared/components/layout/PanelTabBar';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { GitLabConnectionForm } from '@/features/gitlab/components/GitLabConnectionForm';
import { GitLabAgentList } from '@/features/gitlab/components/GitLabAgentList';
import { GitLabDeployModal } from '@/features/gitlab/components/GitLabDeployModal';
import { GitLabPipelineViewer } from '@/features/gitlab/components/GitLabPipelineViewer';
import { GitOpsVersionHistory } from '@/features/gitlab/components/GitOpsVersionHistory';
import { DeploymentHistoryTab } from '@/features/gitlab/components/DeploymentHistoryTab';
import type { CiCdTemplate } from '../data/cicdTemplates';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'connection' | 'agents' | 'deploy' | 'history' | 'pipelines' | 'gitops';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GitLabPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('connection');

  const TABS = [
    { id: 'connection' as TabId, label: t.gitlab.tab_connection, disabledWhenOffline: false },
    { id: 'deploy' as TabId, label: t.gitlab.tab_deploy, disabledWhenOffline: true },
    { id: 'agents' as TabId, label: t.gitlab.tab_agents, disabledWhenOffline: true },
    { id: 'history' as TabId, label: t.gitlab.tab_history, disabledWhenOffline: true },
    { id: 'gitops' as TabId, label: t.gitlab.tab_gitops, disabledWhenOffline: true },
    { id: 'pipelines' as TabId, label: t.gitlab.tab_pipelines, disabledWhenOffline: true },
  ];

  const config = useSystemStore((s) => s.gitlabConfig);
  const isConnecting = useSystemStore((s) => s.gitlabIsConnecting);
  const projects = useSystemStore((s) => s.gitlabProjects);
  const agents = useSystemStore((s) => s.gitlabAgents);
  const error = useSystemStore((s) => s.gitlabError);
  const selectedProjectId = useSystemStore((s) => s.gitlabSelectedProjectId);
  const personas = useAgentStore((s) => s.personas);
  const credentials = useVaultStore((s) => s.credentials);

  const initialize = useSystemStore((s) => s.gitlabInitialize);
  const connectFromVault = useSystemStore((s) => s.gitlabConnectFromVaultAction);
  const disconnect = useSystemStore((s) => s.gitlabDisconnectAction);
  const fetchProjects = useSystemStore((s) => s.gitlabFetchProjects);
  const deployPersona = useSystemStore((s) => s.gitlabDeployPersona);
  const deployPersonaVersioned = useSystemStore((s) => s.gitlabDeployPersonaVersioned);
  const fetchAgents = useSystemStore((s) => s.gitlabFetchAgents);
  const undeployAgent = useSystemStore((s) => s.gitlabUndeployAgent);
  const redeployAgent = useSystemStore((s) => s.gitlabRedeployAgent);
  const redeployingAgentId = useSystemStore((s) => s.gitlabRedeployingAgentId);
  const clearError = useSystemStore((s) => s.gitlabClearError);
  const createPersona = useAgentStore((s) => s.createPersona);

  const isConnected = config?.isConnected ?? false;

  const personaOptions = useMemo(
    () => personas.map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
    [personas],
  );

  const gitlabCredential = useMemo(
    () => credentials.find((c) => c.service_type === 'gitlab'),
    [credentials],
  );

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleConnect = async (instanceUrl?: string) => {
    if (!gitlabCredential) return;
    try {
      await connectFromVault(gitlabCredential.id, instanceUrl);
    } catch {
      // intentional: error state handled locally via store + ErrorBanner
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setActiveTab('connection');
  };

  const handleSelectProject = (id: number) => {
    useSystemStore.setState({ gitlabSelectedProjectId: id });
  };

  const handleDeploySuccess = useCallback(() => {
    if (selectedProjectId) {
      fetchAgents(selectedProjectId);
    }
  }, [selectedProjectId, fetchAgents]);

  const handleCreateFromTemplate = useCallback(async (template: CiCdTemplate): Promise<string> => {
    const persona = await createPersona({
      name: template.name,
      description: template.description,
      system_prompt: template.systemPrompt,
      icon: template.icon,
      color: template.color,
    });
    return persona.id;
  }, [createPersona]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.gitlab.integration_title}
        subtitle={t.gitlab.integration_subtitle}
        actions={<ConnectionStatusBadge connected={isConnected} isBusy={isConnecting} />}
      >
        <PanelTabBar
          tabs={TABS.map((tab) => ({ ...tab, disabled: tab.disabledWhenOffline && !isConnected }))}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          underlineClass="bg-orange-500"
          idPrefix="gitlab-deploy"
          layoutIdPrefix="gitlab-tab"
        />
      </ContentHeader>

      {/* Tab content */}
      <ContentBody>
        <div
          role="tabpanel"
          id={`gitlab-deploy-panel-${activeTab}`}
          aria-labelledby={`gitlab-deploy-tab-${activeTab}`}
        >
          {activeTab === 'connection' && (
            <GitLabConnectionForm
              isConnected={isConnected}
              username={config?.username ?? ''}
              baseUrl={config?.baseUrl ?? 'https://gitlab.com'}
              isConnecting={isConnecting}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          )}
          {activeTab === 'deploy' && isConnected && (
            <GitLabDeployModal
              projects={projects}
              personas={personaOptions}
              selectedProjectId={selectedProjectId}
              onSelectProject={handleSelectProject}
              onFetchProjects={fetchProjects}
              onDeploy={deployPersona}
              onDeployVersioned={deployPersonaVersioned}
              onDeploySuccess={handleDeploySuccess}
              onCreateFromTemplate={handleCreateFromTemplate}
              gitlabTier="free"
            />
          )}
          {activeTab === 'agents' && isConnected && (
            <GitLabAgentList
              projectId={selectedProjectId}
              agents={agents}
              onFetchAgents={fetchAgents}
              onUndeploy={undeployAgent}
              onRedeploy={redeployAgent}
              redeployingAgentId={redeployingAgentId}
            />
          )}
          {activeTab === 'history' && isConnected && (
            <DeploymentHistoryTab projectId={selectedProjectId} />
          )}
          {activeTab === 'gitops' && isConnected && (
            <GitOpsVersionHistory projectId={selectedProjectId} />
          )}
          {activeTab === 'pipelines' && isConnected && (
            <GitLabPipelineViewer projectId={selectedProjectId} />
          )}
        </div>
      </ContentBody>

      {error && <ErrorBanner message={error} onDismiss={clearError} />}
    </ContentBox>
  );
}

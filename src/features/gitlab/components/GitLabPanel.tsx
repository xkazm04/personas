import { useState, useEffect, useCallback } from 'react';
import { GitBranch } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { ConnectionStatusBadge } from '@/features/shared/components/ConnectionStatusBadge';
import { PanelTabBar } from '@/features/shared/components/PanelTabBar';
import { ErrorBanner } from '@/features/shared/components/ErrorBanner';
import { GitLabConnectionForm } from '@/features/gitlab/components/GitLabConnectionForm';
import { GitLabAgentList } from '@/features/gitlab/components/GitLabAgentList';
import { GitLabDeployModal } from '@/features/gitlab/components/GitLabDeployModal';
import { GitLabPipelineViewer } from '@/features/gitlab/components/GitLabPipelineViewer';
import type { CiCdTemplate } from '../data/cicdTemplates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'connection' | 'agents' | 'deploy' | 'pipelines';

interface TabDef {
  id: TabId;
  label: string;
  disabledWhenOffline: boolean;
}

const TABS: TabDef[] = [
  { id: 'connection', label: 'Connection', disabledWhenOffline: false },
  { id: 'deploy', label: 'Deploy', disabledWhenOffline: true },
  { id: 'agents', label: 'Agents', disabledWhenOffline: true },
  { id: 'pipelines', label: 'Pipelines', disabledWhenOffline: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GitLabPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('connection');
  const [token, setToken] = useState('');

  const config = usePersonaStore((s) => s.gitlabConfig);
  const isConnecting = usePersonaStore((s) => s.gitlabIsConnecting);
  const projects = usePersonaStore((s) => s.gitlabProjects);
  const agents = usePersonaStore((s) => s.gitlabAgents);
  const error = usePersonaStore((s) => s.gitlabError);
  const selectedProjectId = usePersonaStore((s) => s.gitlabSelectedProjectId);
  const personas = usePersonaStore((s) => s.personas);

  const initialize = usePersonaStore((s) => s.gitlabInitialize);
  const connect = usePersonaStore((s) => s.gitlabConnectAction);
  const disconnect = usePersonaStore((s) => s.gitlabDisconnectAction);
  const fetchProjects = usePersonaStore((s) => s.gitlabFetchProjects);
  const deployPersona = usePersonaStore((s) => s.gitlabDeployPersona);
  const fetchAgents = usePersonaStore((s) => s.gitlabFetchAgents);
  const undeployAgent = usePersonaStore((s) => s.gitlabUndeployAgent);
  const clearError = usePersonaStore((s) => s.gitlabClearError);
  const createPersona = usePersonaStore((s) => s.createPersona);

  const isConnected = config?.isConnected ?? false;

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleConnect = async () => {
    if (!token.trim()) return;
    try {
      await connect(token.trim());
    } catch {
      // intentional: error state handled locally via store + ErrorBanner
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setToken('');
    setActiveTab('connection');
  };

  const handleSelectProject = (id: number) => {
    usePersonaStore.setState({ gitlabSelectedProjectId: id });
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
        title="GitLab Integration"
        subtitle="Deploy personas as GitLab Duo Agents"
        actions={<ConnectionStatusBadge connected={isConnected} isBusy={isConnecting} />}
      >
        <PanelTabBar
          tabs={TABS.map((tab) => ({ ...tab, disabled: tab.disabledWhenOffline && !isConnected }))}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeUnderlineClass="after:bg-orange-500"
          idPrefix="gitlab-deploy"
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
              token={token}
              setToken={setToken}
              isConnecting={isConnecting}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          )}
          {activeTab === 'deploy' && isConnected && (
            <GitLabDeployModal
              projects={projects}
              personas={personas.map((p) => ({ id: p.id, name: p.name, icon: p.icon }))}
              selectedProjectId={selectedProjectId}
              onSelectProject={handleSelectProject}
              onFetchProjects={fetchProjects}
              onDeploy={deployPersona}
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
            />
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

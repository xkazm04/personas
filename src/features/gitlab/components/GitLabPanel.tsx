import { useState, useEffect, useCallback } from 'react';
import { GitBranch } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ConnectionStatusBadge } from '@/features/shared/components/feedback/ConnectionStatusBadge';
import { PanelTabBar } from '@/features/shared/components/layout/PanelTabBar';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
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

  const config = useSystemStore((s) => s.gitlabConfig);
  const isConnecting = useSystemStore((s) => s.gitlabIsConnecting);
  const projects = useSystemStore((s) => s.gitlabProjects);
  const agents = useSystemStore((s) => s.gitlabAgents);
  const error = useSystemStore((s) => s.gitlabError);
  const selectedProjectId = useSystemStore((s) => s.gitlabSelectedProjectId);
  const personas = useAgentStore((s) => s.personas);

  const initialize = useSystemStore((s) => s.gitlabInitialize);
  const connect = useSystemStore((s) => s.gitlabConnectAction);
  const disconnect = useSystemStore((s) => s.gitlabDisconnectAction);
  const fetchProjects = useSystemStore((s) => s.gitlabFetchProjects);
  const deployPersona = useSystemStore((s) => s.gitlabDeployPersona);
  const fetchAgents = useSystemStore((s) => s.gitlabFetchAgents);
  const undeployAgent = useSystemStore((s) => s.gitlabUndeployAgent);
  const clearError = useSystemStore((s) => s.gitlabClearError);
  const createPersona = useAgentStore((s) => s.createPersona);

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
        title="GitLab Integration"
        subtitle="Deploy personas as GitLab Duo Agents"
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

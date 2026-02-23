import { useState, useEffect } from 'react';
import { GitBranch, Wifi, WifiOff } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { GitLabConnectionForm } from '@/features/gitlab/components/GitLabConnectionForm';
import { GitLabAgentList } from '@/features/gitlab/components/GitLabAgentList';
import { GitLabDeployModal } from '@/features/gitlab/components/GitLabDeployModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'connection' | 'agents' | 'deploy';

interface TabDef {
  id: TabId;
  label: string;
  disabledWhenOffline: boolean;
}

const TABS: TabDef[] = [
  { id: 'connection', label: 'Connection', disabledWhenOffline: false },
  { id: 'deploy', label: 'Deploy', disabledWhenOffline: true },
  { id: 'agents', label: 'Agents', disabledWhenOffline: true },
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

  const isConnected = config?.isConnected ?? false;

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleConnect = async () => {
    if (!token.trim()) return;
    try {
      await connect(token.trim());
    } catch {
      // error surfaced via store
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

  const connectionBadge = isConnected ? (
    <span className="flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
      <Wifi className="w-3 h-3" />
      Connected
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-md border bg-red-500/10 border-red-500/20 text-red-400">
      <WifiOff className="w-3 h-3" />
      Disconnected
    </span>
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-orange-400" />}
        iconColor="amber"
        title="GitLab Integration"
        subtitle="Deploy personas as GitLab Duo Agents"
        actions={connectionBadge}
      >
        {/* Tab bar */}
        <div className="flex gap-0 mt-4 -mb-5 -mx-4 md:-mx-6 border-t border-primary/10">
          {TABS.map((tab) => {
            const disabled = tab.disabledWhenOffline && !isConnected;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                disabled={disabled}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  px-5 py-2.5 text-sm font-medium transition-colors relative
                  ${active
                    ? 'text-foreground/90 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-orange-500'
                    : 'text-muted-foreground/90 hover:text-foreground/95'}
                  ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </ContentHeader>

      {/* Tab content */}
      <ContentBody>
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
      </ContentBody>

      {/* Error banner */}
      {error && (
        <div className="px-6 py-3 border-t border-red-500/20 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}
    </ContentBox>
  );
}

import { useState, useEffect } from 'react';
import { Loader2, Rocket, Check, ExternalLink, ShieldCheck, KeyRound } from 'lucide-react';
import type { GitLabProject, GitLabDeployResult } from '@/api/gitlab';

interface GitLabDeployModalProps {
  projects: GitLabProject[];
  personas: Array<{ id: string; name: string; icon: string | null }>;
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
  onFetchProjects: () => Promise<void>;
  onDeploy: (personaId: string, projectId: number, provisionCredentials: boolean) => Promise<GitLabDeployResult>;
}

export function GitLabDeployModal({
  projects,
  personas,
  selectedProjectId,
  onSelectProject,
  onFetchProjects,
  onDeploy,
}: GitLabDeployModalProps) {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [provisionCredentials, setProvisionCredentials] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [result, setResult] = useState<GitLabDeployResult | null>(null);

  useEffect(() => {
    onFetchProjects();
  }, [onFetchProjects]);

  const handleDeploy = async () => {
    if (!selectedPersonaId || !selectedProjectId) return;
    setIsDeploying(true);
    setResult(null);
    try {
      const res = await onDeploy(selectedPersonaId, selectedProjectId, provisionCredentials);
      setResult(res);
    } catch {
      // Error handled by store
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Project picker */}
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">Target Project</label>
        <select
          value={selectedProjectId ?? ''}
          onChange={(e) => onSelectProject(Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-background text-sm text-foreground/90 focus:outline-none focus:border-orange-500/40"
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.pathWithNamespace}
            </option>
          ))}
        </select>
      </div>

      {/* Persona picker */}
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">Persona to Deploy</label>
        <select
          value={selectedPersonaId}
          onChange={(e) => setSelectedPersonaId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-background text-sm text-foreground/90 focus:outline-none focus:border-orange-500/40"
        >
          <option value="">Select a persona...</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon ? `${p.icon} ` : ''}{p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Credential provisioning toggle */}
      <div className="p-3 rounded-lg border border-primary/10 bg-primary/[0.02]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={provisionCredentials}
            onChange={(e) => setProvisionCredentials(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-primary/20 text-orange-500 focus:ring-orange-500/30"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-sm font-medium text-foreground/90">
                Provision API credentials
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Securely push this persona&apos;s tool credentials to the GitLab project as
              masked CI/CD variables. The agent will access them as environment variables at runtime.
            </p>
            {provisionCredentials && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-400/80">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Credentials are transmitted over HTTPS and stored as masked, protected
                  variables. They will not appear in job logs or the system prompt.
                </span>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Deploy button */}
      <button
        onClick={handleDeploy}
        disabled={isDeploying || !selectedPersonaId || !selectedProjectId}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-500/15 border border-orange-500/25 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isDeploying ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Rocket className="w-4 h-4" />
        )}
        {isDeploying ? 'Deploying...' : 'Deploy to GitLab'}
      </button>

      {/* Result */}
      {result && (
        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-start gap-2">
            <Check className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-400">
                Deployed successfully via {result.method === 'api' ? 'Duo Agent API' : 'AGENTS.md'}
              </p>
              {result.agentId && (
                <p className="text-sm text-muted-foreground/70 mt-1">Agent ID: {result.agentId}</p>
              )}
              {result.credentialsProvisioned > 0 && (
                <p className="text-sm text-muted-foreground/70 mt-1 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-orange-400" />
                  {result.credentialsProvisioned} credential{result.credentialsProvisioned !== 1 ? 's' : ''} provisioned as CI/CD variables
                </p>
              )}
              {result.webUrl && (
                <button
                  onClick={() => window.open(result.webUrl!, '_blank')}
                  className="mt-2 flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View in GitLab
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

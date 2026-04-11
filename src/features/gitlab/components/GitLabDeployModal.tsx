import { useState, useEffect, useRef } from 'react';
import { Rocket, Check, ExternalLink, ShieldCheck, KeyRound, Tag } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { GitLabProject, GitLabDeployResult } from '@/api/system/gitlab';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { CiCdTemplatesPicker } from './CiCdTemplatesPicker';
import type { CiCdTemplate, GitLabTierId } from '../data/cicdTemplates';
import { useTranslation } from '@/i18n/useTranslation';

interface GitLabDeployModalProps {
  projects: GitLabProject[];
  personas: Array<{ id: string; name: string; icon: string | null }>;
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
  onFetchProjects: () => Promise<void>;
  onDeploy: (personaId: string, projectId: number, provisionCredentials: boolean) => Promise<GitLabDeployResult>;
  onDeployVersioned?: (personaId: string, projectId: number, provisionCredentials: boolean, environment?: string) => Promise<GitLabDeployResult>;
  onDeploySuccess?: () => void;
  onCreateFromTemplate?: (template: CiCdTemplate) => Promise<string>;
  gitlabTier?: GitLabTierId;
}

export function GitLabDeployModal({
  projects,
  personas,
  selectedProjectId,
  onSelectProject,
  onFetchProjects,
  onDeploy,
  onDeployVersioned,
  onDeploySuccess,
  onCreateFromTemplate,
  gitlabTier = 'free',
}: GitLabDeployModalProps) {
  const { t, tx } = useTranslation();
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [provisionCredentials, setProvisionCredentials] = useState(false);
  const [enableVersioning, setEnableVersioning] = useState(true);
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [isCreatingFromTemplate, setIsCreatingFromTemplate] = useState(false);
  const [result, setResult] = useState<GitLabDeployResult | null>(null);
  const deployingRef = useRef(false);

  useEffect(() => {
    onFetchProjects();
  }, [onFetchProjects]);

  const handleSelectTemplate = async (template: CiCdTemplate) => {
    if (!onCreateFromTemplate || isCreatingFromTemplate) return;
    setIsCreatingFromTemplate(true);
    try {
      const newPersonaId = await onCreateFromTemplate(template);
      setSelectedPersonaId(newPersonaId);
    } catch {
      // intentional: error state handled locally via store + ErrorBanner
    } finally {
      setIsCreatingFromTemplate(false);
    }
  };

  const handleDeploy = async () => {
    if (deployingRef.current) return;
    if (!selectedPersonaId || !selectedProjectId) return;
    deployingRef.current = true;
    setIsDeploying(true);
    setResult(null);
    try {
      let res: GitLabDeployResult;
      if (enableVersioning && onDeployVersioned) {
        res = await onDeployVersioned(
          selectedPersonaId,
          selectedProjectId,
          provisionCredentials,
          selectedEnvironment || undefined,
        );
      } else {
        res = await onDeploy(selectedPersonaId, selectedProjectId, provisionCredentials);
      }
      setResult(res);
      onDeploySuccess?.();
    } catch {
      // intentional: error state handled locally via store + ErrorBanner
    } finally {
      setIsDeploying(false);
      deployingRef.current = false;
    }
  };

  return (
    <div className="space-y-4">
      {/* Project picker */}
      <div>
        <label htmlFor="target-project" className="block text-sm font-medium text-foreground/80 mb-1.5">{t.gitlab.target_project}</label>
        <ThemedSelect
          id="target-project"
          value={String(selectedProjectId ?? '')}
          onChange={(e) => onSelectProject(Number(e.target.value))}
        >
          <option value="">{t.gitlab.select_project}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.pathWithNamespace}
            </option>
          ))}
        </ThemedSelect>
      </div>

      {/* Persona picker */}
      <div>
        <label htmlFor="deploy-persona" className="block text-sm font-medium text-foreground/80 mb-1.5">{t.gitlab.persona_to_deploy}</label>
        <ThemedSelect
          id="deploy-persona"
          value={selectedPersonaId}
          onChange={(e) => setSelectedPersonaId(e.target.value)}
        >
          <option value="">{t.gitlab.select_persona}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon ? `${p.icon} ` : ''}{p.name}
            </option>
          ))}
        </ThemedSelect>
      </div>

      {/* CI/CD Agent Templates */}
      <div className="p-3 rounded-xl border border-primary/10 bg-secondary/10">
        <CiCdTemplatesPicker
          userTier={gitlabTier}
          onSelectTemplate={handleSelectTemplate}
        />
        {isCreatingFromTemplate && (
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground/60">
            <LoadingSpinner size="sm" />
            {t.gitlab.creating_from_template}
          </div>
        )}
      </div>

      {/* Credential provisioning toggle */}
      <div className="p-3 rounded-lg border border-primary/10 bg-primary/[0.02]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={provisionCredentials}
            onChange={(e) => setProvisionCredentials(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-primary/20 text-orange-500 focus-visible:ring-orange-500/30"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-sm font-medium text-foreground/90">
                {t.gitlab.provision_api_credentials}
              </span>
            </div>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {t.gitlab.provision_description}
            </p>
            {provisionCredentials && (
              <div className="mt-2 flex items-start gap-1.5 text-sm text-amber-400/80">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t.gitlab.provision_security_note}
                </span>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Version tagging toggle */}
      <div className="p-3 rounded-lg border border-primary/10 bg-primary/[0.02]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enableVersioning}
            onChange={(e) => setEnableVersioning(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-primary/20 text-amber-500 focus-visible:ring-amber-500/30"
          />
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-sm font-medium text-foreground/90">
                {t.gitlab.version_controlled_deploy}
              </span>
            </div>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {t.gitlab.version_description}
            </p>
            {enableVersioning && (
              <div className="mt-2">
                <label htmlFor="deploy-env" className="block text-xs text-muted-foreground/60 mb-1">
                  {t.gitlab.target_environment}
                </label>
                <select
                  id="deploy-env"
                  value={selectedEnvironment}
                  onChange={(e) => setSelectedEnvironment(e.target.value)}
                  className="w-full rounded-lg border border-primary/15 bg-secondary/30 px-2.5 py-1.5 text-sm text-foreground/90 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                >
                  <option value="">{t.gitlab.no_environment}</option>
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="production">production</option>
                </select>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Deploy button */}
      <button
        onClick={handleDeploy}
        disabled={isDeploying || !selectedPersonaId || !selectedProjectId}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-500/15 border border-orange-500/25 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isDeploying ? (
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
            <LoadingSpinner />
            <span className="sr-only">Deploying persona to GitLab...</span>
          </span>
        ) : (
          <Rocket className="w-4 h-4" />
        )}
        {isDeploying ? t.gitlab.deploying : t.gitlab.deploy_to_gitlab}
      </button>

      {/* Result */}
      {result && (
        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-start gap-2">
            <Check className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-400">
                {tx(t.gitlab.deployed_successfully, { method: result.method === 'api' ? t.gitlab.duo_agent_api : t.gitlab.agents_md })}
              </p>
              {result.agentId && (
                <p className="text-sm text-muted-foreground/70 mt-1">{tx(t.gitlab.agent_id, { id: result.agentId })}</p>
              )}
              {result.credentialsProvisioned > 0 && (
                <p className="text-sm text-muted-foreground/70 mt-1 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-orange-400" />
                  {result.credentialsProvisioned} credential{result.credentialsProvisioned !== 1 ? 's' : ''} provisioned
                </p>
              )}
              {sanitizeExternalUrl(result.webUrl) && (
                <a
                  href={sanitizeExternalUrl(result.webUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t.gitlab.view_in_gitlab}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { Rocket, Check, ExternalLink, ShieldCheck, KeyRound, Tag } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { GitLabProject, GitLabDeployResult } from '@/api/system/gitlab';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { CiCdTemplatesPicker } from './CiCdTemplatesPicker';
import type { CiCdTemplate, GitLabTierId } from '../data/cicdTemplates';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


import Button from '@/features/shared/components/buttons/Button';

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
    } catch (err) { silentCatch("features/plugins/gitlab/components/GitLabDeployModal:catch1")(err); } finally {
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
    } catch (err) { silentCatch("features/plugins/gitlab/components/GitLabDeployModal:catch2")(err); } finally {
      setIsDeploying(false);
      deployingRef.current = false;
    }
  };

  return (
    <div className="space-y-4">
      {/* Project picker */}
      <div>
        <label htmlFor="target-project" className="block typo-body text-ink-1 mb-1.5">{t.gitlab.target_project}</label>
        <ThemedSelect
          id="target-project"
          value={String(selectedProjectId ?? '')}
          onChange={(e) => onSelectProject(Number(e.target.value))}
        >
          <option value="">{t.gitlab.select_project}</option>
          {projects.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {p.pathWithNamespace}
            </option>
          ))}
        </ThemedSelect>
      </div>

      {/* Persona picker */}
      <div>
        <label htmlFor="deploy-persona" className="block typo-body text-ink-1 mb-1.5">{t.gitlab.persona_to_deploy}</label>
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
      <div className="p-3 rounded-modal border border-hair bg-surface-1">
        <CiCdTemplatesPicker
          userTier={gitlabTier}
          onSelectTemplate={handleSelectTemplate}
        />
        {isCreatingFromTemplate && (
          <div className="mt-2 flex items-center gap-2 typo-body text-ink-1">
            <LoadingSpinner size="sm" />
            {t.gitlab.creating_from_template}
          </div>
        )}
      </div>

      {/* Credential provisioning toggle */}
      <div className="p-3 rounded-card border border-hair bg-primary/[0.02]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={provisionCredentials}
            onChange={(e) => setProvisionCredentials(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded-interactive border-hair text-status-warning focus-visible:ring-status-warning/30"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-status-warning" />
              <span className="typo-body text-ink-2">
                {t.gitlab.provision_api_credentials}
              </span>
            </div>
            <p className="typo-body text-ink-1 mt-1">
              {t.gitlab.provision_description}
            </p>
            {provisionCredentials && (
              <div className="mt-2 flex items-start gap-1.5 typo-body text-status-warning">
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
      <div className="p-3 rounded-card border border-hair bg-primary/[0.02]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enableVersioning}
            onChange={(e) => setEnableVersioning(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded-interactive border-hair text-status-warning focus-visible:ring-status-warning/30"
          />
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-status-warning" />
              <span className="typo-body text-ink-2">
                {t.gitlab.version_controlled_deploy}
              </span>
            </div>
            <p className="typo-body text-ink-1 mt-1">
              {t.gitlab.version_description}
            </p>
            {enableVersioning && (
              <div className="mt-2">
                <label htmlFor="deploy-env" className="block typo-caption text-ink-2 mb-1">
                  {t.gitlab.target_environment}
                </label>
                <select
                  id="deploy-env"
                  value={selectedEnvironment}
                  onChange={(e) => setSelectedEnvironment(e.target.value)}
                  className="w-full rounded-card border border-hair bg-surface-1 px-2.5 py-1.5 typo-body text-ink-2 focus:outline-none focus:ring-1 focus:ring-status-warning/30"
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
      <Button
        type="button"
        onClick={handleDeploy}
        disabled={isDeploying || !selectedPersonaId || !selectedProjectId}
        variant="secondary"
        size="sm"
      >
        {isDeploying ? (
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
            <LoadingSpinner />
            <span className="sr-only">{t.gitlab.deploying_to_gitlab}</span>
          </span>
        ) : (
          <Rocket className="w-4 h-4" />
        )}
        {isDeploying ? t.gitlab.deploying : t.gitlab.deploy_to_gitlab}
      </Button>

      {/* Result */}
      {result && (
        <div className="p-4 rounded-modal bg-status-success/5 border border-status-success/20">
          <div className="flex items-start gap-2">
            <Check className="w-5 h-5 text-status-success mt-0.5 flex-shrink-0" />
            <div>
              <p className="typo-body text-status-success">
                {tx(t.gitlab.deployed_successfully, { method: result.method === 'api' ? t.gitlab.duo_agent_api : t.gitlab.agents_md })}
              </p>
              {result.agentId && (
                <p className="typo-body text-ink-1 mt-1">{tx(t.gitlab.agent_id, { id: result.agentId })}</p>
              )}
              {result.credentialsProvisioned > 0 && (
                <p className="typo-body text-ink-1 mt-1 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-status-warning" />
                  {tx(result.credentialsProvisioned === 1 ? t.gitlab.credential_provisioned_count_one : t.gitlab.credential_provisioned_count_other, { count: result.credentialsProvisioned })}
                </p>
              )}
              {sanitizeExternalUrl(result.webUrl) && (
                <a
                  href={sanitizeExternalUrl(result.webUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1.5 typo-body text-status-warning hover:text-status-warning"
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

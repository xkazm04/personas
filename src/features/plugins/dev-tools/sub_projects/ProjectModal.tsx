/**
 * ProjectModal — create and edit project dialog.
 * Extracted from ProjectManagerPage to isolate the multi-step modal flow.
 */
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import {
  FolderOpen, X, Plus, Pencil, Search, CheckCircle2, Users, CheckSquare, Square, Code2,
} from 'lucide-react';
import {
  type ProjectType, type EditProjectData, PROJECT_TYPES,
} from './projectManagerTypes';
import { GitHubRepoSelector } from './GitHubRepoSelector';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useVaultStore } from '@/stores/vaultStore';
import { listCredentials } from '@/api/vault/credentials';


type ModalStep = 'form' | 'created';

interface ProjectFormData {
  name: string;
  path: string;
  projectType: ProjectType;
  githubUrl: string;
  teamId: string | null;
  /** Vault GitHub PAT credential id bound for PR / source-control ops. */
  prCredentialId: string | null;
}

interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: ProjectFormData) => Promise<{ id: string } | undefined>;
  onUpdate: (id: string, data: Omit<ProjectFormData, 'path'>) => Promise<void>;
  onScanNow: (projectId: string, rootPath: string, projectName: string) => void;
  editProject?: EditProjectData | null;
}

export function ProjectModal({
  open: isOpen,
  onClose,
  onCreate,
  onUpdate,
  onScanNow,
  editProject,
}: ProjectModalProps) {
  const { t } = useTranslation();
  const isEdit = !!editProject;

  const [step, setStep] = useState<ModalStep>('form');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('other');
  const [githubUrl, setGithubUrl] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [prCredentialId, setPrCredentialId] = useState<string | null>(null);
  // Vault GitHub PAT credentials, offered as the project's source-control
  // connector (persisted as pr_credential_id — authorises PR / git ops).
  const [githubCreds, setGithubCreds] = useState<{ id: string; name: string }[]>([]);
  const [nameEdited, setNameEdited] = useState(false);
  // Opt-in: auto-create a Codebase connector for the new project so the user
  // doesn't have to open the credential catalog and add one manually.
  const [createConnector, setCreateConnector] = useState(true);
  const [createdProject, setCreatedProject] = useState<{ id: string; name: string; path: string } | null>(null);
  const { shouldAnimate: _shouldAnimate } = useMotion();

  // Teams roster for the binding picker (cycle 5).
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => {
    if (isOpen) {
      fetchTeams();
      // Load vault GitHub PAT credentials for the connector picker.
      listCredentials()
        .then((creds) =>
          setGithubCreds(
            creds
              .filter((c) => c.serviceType === 'github' || c.serviceType === 'github_actions')
              .map((c) => ({ id: c.id, name: c.name })),
          ),
        )
        .catch(silentCatch('ProjectModal:listGithubCreds'));
    }
  }, [isOpen, fetchTeams]);

  // Pre-fill form when editing
  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setPath(editProject.path);
      setProjectType(editProject.projectType);
      setGithubUrl(editProject.githubUrl);
      setTeamId(editProject.teamId);
      setPrCredentialId(editProject.prCredentialId);
      setNameEdited(true);
    }
  }, [editProject]);

  const handleSelectFolder = async () => {
    if (isEdit) return; // path is read-only in edit mode
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select project folder',
      });
      if (!selected) return;
      const folderPath = typeof selected === 'string' ? selected : selected;
      setPath(folderPath);
      if (!nameEdited) {
        const segments = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/);
        const folderName = segments[segments.length - 1] || '';
        setName(folderName);
      }
    } catch (err) { silentCatch("features/plugins/dev-tools/sub_projects/ProjectModal:catch1")(err); }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameEdited(true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !path.trim()) return;

    if (isEdit && editProject) {
      await onUpdate(editProject.id, {
        name: name.trim(),
        projectType,
        githubUrl: githubUrl.trim(),
        teamId,
        prCredentialId,
      });
      handleClose();
    } else {
      const result = await onCreate({
        name: name.trim(),
        path: path.trim(),
        projectType,
        githubUrl: githubUrl.trim(),
        teamId,
        prCredentialId,
      });
      if (result) {
        // Optionally create a Codebase connector wired to the new project so
        // agents can read it without a manual trip to the credential catalog.
        // Mirrors the data shape produced by CodebaseProjectPicker (single mode).
        if (createConnector) {
          try {
            await useVaultStore.getState().createCredential({
              name: `Codebase — ${name.trim()}`,
              service_type: 'codebase',
              data: {
                project_id: result.id,
                project_name: name.trim(),
                root_path: path.trim(),
                tech_stack: projectType,
              },
            });
          } catch (err) {
            toastCatch('Failed to create Codebase connector')(err);
          }
        }
        setCreatedProject({ id: result.id, name: name.trim(), path: path.trim() });
        setStep('created');
      }
    }
  };

  const handleClose = () => {
    setStep('form');
    setName('');
    setPath('');
    setProjectType('other');
    setGithubUrl('');
    setTeamId(null);
    setPrCredentialId(null);
    setNameEdited(false);
    setCreateConnector(true);
    setCreatedProject(null);
    onClose();
  };

  const handleScanNow = () => {
    if (createdProject) {
      onScanNow(createdProject.id, createdProject.path, createdProject.name);
    }
    handleClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId="dev-tools-project-modal-title"
      maxWidthClass="max-w-[33.6rem]"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4"
    >
      <div>
          {step === 'form' ? (
            <>
              <div className="flex items-center justify-between mb-5">
                <h2 id="dev-tools-project-modal-title" className="typo-section-title">
                  {isEdit ? t.plugins.dev_projects.edit_project : t.plugins.dev_projects.new_project}
                </h2>
                <Button variant="ghost" size="icon-sm" onClick={handleClose}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                {/* Folder picker (read-only in edit mode) */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 block">{t.plugins.dev_projects.project_folder}</label>
                  <div className="flex gap-2">
                    <div
                      onClick={isEdit ? undefined : handleSelectFolder}
                      className={`flex-1 flex items-center gap-2 px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal min-w-0 ${
                        isEdit ? 'opacity-60' : 'cursor-pointer hover:bg-secondary/60 transition-colors'
                      }`}
                    >
                      <FolderOpen className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      {path ? (
                        <span className="text-foreground truncate">{path}</span>
                      ) : (
                        <span className="text-foreground">{t.plugins.dev_projects.select_folder}</span>
                      )}
                    </div>
                    {!isEdit && (
                      <Button variant="secondary" size="sm" onClick={handleSelectFolder}>
                        Browse
                      </Button>
                    )}
                  </div>
                </div>

                {/* Project Name */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    {t.plugins.dev_projects.project_name}
                    {!isEdit && path && !nameEdited && (
                      <span className="text-[10px] text-foreground font-normal">({t.plugins.dev_projects.auto_filled_from_folder})</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder={t.plugins.dev_projects.project_name_placeholder}
                      className="w-full px-3 py-2 pr-8 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground focus-ring"
                    />
                    <Pencil className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
                  </div>
                </div>

                {/* Project Type */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    {t.plugins.dev_projects.project_type}
                    <span className="text-[10px] text-foreground font-normal">({t.plugins.dev_projects.project_type_optional})</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROJECT_TYPES.map((pt) => (
                      <button
                        key={pt.id}
                        onClick={() => setProjectType(pt.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card border transition-all ${
                          projectType === pt.id
                            ? `${pt.color} ring-1 ring-current/20 scale-105`
                            : 'bg-secondary/30 border-primary/10 text-foreground hover:bg-secondary/50'
                        }`}
                      >
                        <span>{pt.icon}</span>
                        {pt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* GitHub connector — bind a vault GitHub PAT so the project's
                    PR / source-control operations (auto-PR, review comments)
                    can authenticate. Persisted as pr_credential_id. */}
                <div data-testid="project-github-connector">
                  <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    {t.plugins.dev_projects.github_connector_label}
                    <span className="text-[10px] text-foreground font-normal">
                      ({t.plugins.dev_projects.team_binding_optional})
                    </span>
                  </label>
                  <ThemedSelect
                    value={prCredentialId ?? ''}
                    onValueChange={(v) => setPrCredentialId(v || null)}
                  >
                    <option value="">{t.plugins.dev_projects.team_binding_none}</option>
                    {githubCreds.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </ThemedSelect>
                </div>

                {/* GitHub URL -- repo selector (if PAT available) or manual input */}
                <GitHubRepoSelector value={githubUrl} onChange={setGithubUrl} />

                {/* Team binding — optional; ties this project to a PersonaTeam
                    pipeline so the project surface shows the pipeline inline. */}
                <div>
                  <label className="typo-caption font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {t.plugins.dev_projects.team_binding_label}
                    <span className="text-[10px] text-foreground font-normal">
                      ({t.plugins.dev_projects.team_binding_optional})
                    </span>
                  </label>
                  <ThemedSelect
                    value={teamId ?? ''}
                    onValueChange={(v) => setTeamId(v || null)}
                  >
                    <option value="">{t.plugins.dev_projects.team_binding_none}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </ThemedSelect>
                  {teams.length === 0 && (
                    <p className="typo-caption text-foreground/60 mt-1">
                      {t.plugins.dev_projects.team_binding_empty}
                    </p>
                  )}
                </div>

                {/* Auto-create a Codebase connector (create mode only) so the
                    user skips a manual trip to the credential catalog. */}
                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => setCreateConnector((v) => !v)}
                    aria-pressed={createConnector}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left bg-secondary/30 border border-primary/10 rounded-modal hover:bg-secondary/50 transition-colors"
                  >
                    {createConnector
                      ? <CheckSquare className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      : <Square className="w-4 h-4 text-foreground flex-shrink-0 mt-0.5" />}
                    <span className="min-w-0">
                      <span className="typo-caption font-medium text-foreground flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5 text-amber-400" />
                        {t.plugins.dev_projects.create_codebase_connector_label}
                      </span>
                      <span className="block typo-caption text-foreground mt-0.5">
                        {t.plugins.dev_projects.create_codebase_connector_desc.replace('{name}', name.trim() || t.plugins.dev_projects.project_name)}
                      </span>
                    </span>
                  </button>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" size="sm" onClick={handleClose}>{t.common.cancel}</Button>
                <Button
                  variant="accent"
                  accentColor="amber"
                  size="sm"
                  icon={isEdit ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  disabled={!name.trim() || !path.trim()}
                  onClick={handleSubmit}
                >
                  {isEdit ? t.common.save : t.plugins.dev_projects.new_project}
                </Button>
              </div>
            </>
          ) : (
            /* Post-creation step: offer context scan */
            <>
              <div className="text-center py-2">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h2 className="typo-section-title mb-1">
                  {t.plugins.dev_projects.project_created}
                </h2>
                <p className="typo-caption text-foreground mb-6">
                  <span className="font-medium text-foreground">{createdProject?.name}</span> {t.plugins.dev_projects.project_ready_desc}
                </p>

                <div className="bg-primary/5 border border-primary/10 rounded-modal p-4 mb-6 text-left">
                  <div className="flex items-start gap-3">
                    <Search className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="typo-card-label mb-1">{t.plugins.dev_projects.generate_context_map}</h4>
                      <p className="typo-caption text-foreground">
                        {t.plugins.dev_projects.generate_context_map_desc}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleClose}>
                    {t.plugins.dev_projects.skip_for_now}
                  </Button>
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={<Search className="w-3.5 h-3.5" />}
                    onClick={handleScanNow}
                  >
                    {t.plugins.dev_projects.scan_codebase}
                  </Button>
                </div>
              </div>
            </>
          )}
      </div>
    </BaseModal>
  );
}

/**
 * ProjectModal — create and edit project dialog, rendered as a horizontal
 * SDLC pipeline-stepper.
 *
 * Stage 1 (Project): folder path + name. Stage 2 (Source control): a
 * Team / Standalone switch, repo, main branch, and living-test-environment.
 * The old flat "Workspace" section is folded into stage 2 (team binding).
 * Phase 1 ships two stages; the rail + stage-component pattern grows by
 * appending a `PipelineStage` + an editor component.
 */
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import {
  X, Plus, Pencil, Search, CheckCircle2, FolderKanban, GitBranch, ArrowLeft, ArrowRight,
} from 'lucide-react';
import {
  type ProjectType, type EditProjectData,
} from './projectManagerTypes';
import { PipelineRail } from './pipeline/PipelineRail';
import { ProjectStep } from './pipeline/ProjectStep';
import { SourceControlStep } from './pipeline/SourceControlStep';
import type { PipelineStage, SourceMode } from './pipeline/pipelineTypes';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useVaultStore } from '@/stores/vaultStore';
import { listCredentials } from '@/api/vault/credentials';

type ModalPhase = 'form' | 'created';

interface ProjectFormData {
  name: string;
  path: string;
  projectType: ProjectType;
  githubUrl: string;
  teamId: string | null;
  /** Vault GitHub PAT credential id bound for PR / source-control ops. */
  prCredentialId: string | null;
  /** URL of the living test environment this project/team delivers into. */
  testEnvUrl: string;
  /** Branch deployed to the living test environment (e.g. `staging`). */
  testEnvBranch: string;
  /** Project's primary/default branch (e.g. `main`/`master`). */
  mainBranch: string;
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
  const dp = t.plugins.dev_projects;
  const isEdit = !!editProject;

  const [phase, setPhase] = useState<ModalPhase>('form');
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('other');
  const [githubUrl, setGithubUrl] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('standalone');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [prCredentialId, setPrCredentialId] = useState<string | null>(null);
  const [testEnvUrl, setTestEnvUrl] = useState('');
  const [testEnvBranch, setTestEnvBranch] = useState('');
  const [mainBranch, setMainBranch] = useState('');
  // Vault GitHub PAT credentials offered as the standalone source-control
  // connector (persisted as pr_credential_id — authorises PR / git ops).
  const [githubCreds, setGithubCreds] = useState<{ id: string; name: string }[]>([]);
  const [nameEdited, setNameEdited] = useState(false);
  // Opt-in: auto-create a Codebase connector for the new project.
  const [createConnector, setCreateConnector] = useState(true);
  const [createdProject, setCreatedProject] = useState<{ id: string; name: string; path: string } | null>(null);

  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => {
    if (isOpen) {
      fetchTeams();
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

  // Pre-fill when editing. Source mode is derived from which binding exists.
  useEffect(() => {
    if (editProject) {
      setName(editProject.name);
      setPath(editProject.path);
      setProjectType(editProject.projectType);
      setGithubUrl(editProject.githubUrl);
      setTeamId(editProject.teamId);
      setPrCredentialId(editProject.prCredentialId);
      setTestEnvUrl(editProject.testEnvUrl ?? '');
      setTestEnvBranch(editProject.testEnvBranch ?? '');
      setMainBranch(editProject.mainBranch ?? '');
      setSourceMode(editProject.teamId ? 'team' : 'standalone');
      setNameEdited(true);
      setStepIndex(0);
    }
  }, [editProject]);

  const handleSelectFolder = async () => {
    if (isEdit) return; // path is read-only in edit mode
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select project folder' });
      if (!selected) return;
      const folderPath = typeof selected === 'string' ? selected : selected;
      setPath(folderPath);
      if (!nameEdited) {
        const segments = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/);
        setName(segments[segments.length - 1] || '');
      }
    } catch (err) { silentCatch('features/plugins/dev-tools/sub_projects/ProjectModal:selectFolder')(err); }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    setNameEdited(true);
  };

  // Stage completion drives both the rail tint and submit validation.
  const stage0Complete = !!name.trim() && !!path.trim();
  const stage1Complete = sourceMode === 'team' ? !!teamId : !!prCredentialId;
  const canSubmit = stage0Complete && stage1Complete;

  const STEP_COUNT = 2;
  const stages: PipelineStage[] = [
    { id: 'project', label: dp.pipeline_step_project, icon: FolderKanban, status: stepIndex === 0 ? 'active' : stage0Complete ? 'complete' : 'incomplete' },
    { id: 'source', label: dp.pipeline_step_source, icon: GitBranch, status: stepIndex === 1 ? 'active' : stage1Complete ? 'complete' : 'incomplete' },
  ];

  // Mode is mutually exclusive at the data layer: team mode nulls the
  // connector, standalone nulls the team binding.
  const effectiveTeamId = sourceMode === 'team' ? teamId : null;
  const effectivePrCredentialId = sourceMode === 'standalone' ? prCredentialId : null;

  const buildFormData = (): ProjectFormData => ({
    name: name.trim(),
    path: path.trim(),
    projectType,
    githubUrl: githubUrl.trim(),
    teamId: effectiveTeamId,
    prCredentialId: effectivePrCredentialId,
    testEnvUrl: testEnvUrl.trim(),
    testEnvBranch: testEnvBranch.trim(),
    mainBranch: mainBranch.trim(),
  });

  const handleSubmit = async () => {
    if (!stage0Complete) { setStepIndex(0); return; }
    if (!stage1Complete) { setStepIndex(1); return; }
    const data = buildFormData();

    if (isEdit && editProject) {
      // `data` carries `path` too, but onUpdate's param omits it — the extra
      // key is harmless for a non-literal argument.
      await onUpdate(editProject.id, data);
      handleClose();
      return;
    }

    const result = await onCreate(data);
    if (!result) return;
    // Auto-create a Codebase connector wired to the new project (incl. repo +
    // main branch) so agents can read it without a manual catalog trip.
    if (createConnector) {
      const codebaseData: Record<string, string> = {
        project_id: result.id,
        project_name: data.name,
        root_path: data.path,
        tech_stack: data.projectType,
      };
      if (data.githubUrl) codebaseData.github_url = data.githubUrl;
      if (data.mainBranch) codebaseData.main_branch = data.mainBranch;
      try {
        await useVaultStore.getState().createCredential({
          name: `Codebase — ${data.name}`,
          service_type: 'codebase',
          data: codebaseData,
        });
      } catch (err) {
        toastCatch('Failed to create Codebase connector')(err);
      }
    }
    setCreatedProject({ id: result.id, name: data.name, path: data.path });
    setPhase('created');
  };

  const handleClose = () => {
    setPhase('form');
    setStepIndex(0);
    setName('');
    setPath('');
    setProjectType('other');
    setGithubUrl('');
    setSourceMode('standalone');
    setTeamId(null);
    setPrCredentialId(null);
    setTestEnvUrl('');
    setTestEnvBranch('');
    setMainBranch('');
    setNameEdited(false);
    setCreateConnector(true);
    setCreatedProject(null);
    onClose();
  };

  const handleScanNow = () => {
    if (createdProject) onScanNow(createdProject.id, createdProject.path, createdProject.name);
    handleClose();
  };

  const isLastStep = stepIndex === STEP_COUNT - 1;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId="dev-tools-project-modal-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4 max-h-[88vh] overflow-y-auto"
    >
      <div>
        {phase === 'form' ? (
          <>
            <div className="flex items-start justify-between mb-5">
              <div className="min-w-0">
                <h2 id="dev-tools-project-modal-title" className="typo-heading-lg font-semibold text-foreground">
                  {isEdit ? dp.edit_project : dp.new_project}
                </h2>
                <p className="typo-caption text-foreground mt-1">
                  {isEdit ? dp.edit_project_subtitle : dp.new_project_subtitle}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Pipeline rail */}
            <div className="px-2 sm:px-8 mb-6">
              <PipelineRail stages={stages} activeIndex={stepIndex} onSelect={setStepIndex} />
            </div>

            {/* Active stage editor */}
            <div className="min-h-[18rem]">
              {stepIndex === 0 ? (
                <ProjectStep
                  isEdit={isEdit}
                  path={path}
                  name={name}
                  nameEdited={nameEdited}
                  projectType={projectType}
                  onSelectFolder={handleSelectFolder}
                  onNameChange={handleNameChange}
                  onTypeChange={setProjectType}
                />
              ) : (
                <SourceControlStep
                  sourceMode={sourceMode}
                  onModeChange={setSourceMode}
                  teams={teams.map((tm) => ({ id: tm.id, name: tm.name }))}
                  teamId={teamId}
                  onTeamChange={setTeamId}
                  githubCreds={githubCreds}
                  prCredentialId={prCredentialId}
                  onCredChange={setPrCredentialId}
                  githubUrl={githubUrl}
                  onGithubUrlChange={setGithubUrl}
                  mainBranch={mainBranch}
                  onMainBranchChange={setMainBranch}
                  testEnvUrl={testEnvUrl}
                  onTestEnvUrlChange={setTestEnvUrl}
                  testEnvBranch={testEnvBranch}
                  onTestEnvBranchChange={setTestEnvBranch}
                />
              )}
            </div>

            {/* Codebase connector opt-in (create mode, last step only) */}
            {!isEdit && isLastStep && (
              <button
                type="button"
                onClick={() => setCreateConnector((v) => !v)}
                aria-pressed={createConnector}
                className={`mt-4 w-full flex items-start gap-3 px-3 py-3 text-left border rounded-input transition-colors ${
                  createConnector ? 'bg-amber-500/5 border-amber-500/25' : 'bg-secondary/30 border-primary/10 hover:bg-secondary/50'
                }`}
              >
                {createConnector
                  ? <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  : <span className="w-4 h-4 rounded border border-primary/30 flex-shrink-0 mt-0.5" />}
                <span className="min-w-0">
                  <span className="typo-caption font-medium text-foreground">{dp.create_codebase_connector_label}</span>
                  <span className="block typo-caption text-foreground mt-0.5 leading-relaxed">
                    {dp.create_codebase_connector_desc.replace('{name}', name.trim() || dp.project_name)}
                  </span>
                </span>
              </button>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-primary/10">
              <Button variant="ghost" size="sm" onClick={handleClose}>{t.common.cancel}</Button>
              <div className="flex items-center gap-2">
                {stepIndex > 0 && (
                  <Button variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setStepIndex(stepIndex - 1)}>
                    {dp.pipeline_back}
                  </Button>
                )}
                {!isLastStep ? (
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    iconRight={<ArrowRight className="w-3.5 h-3.5" />}
                    disabled={stepIndex === 0 && !stage0Complete}
                    onClick={() => setStepIndex(stepIndex + 1)}
                  >
                    {dp.pipeline_next}
                  </Button>
                ) : (
                  <Button
                    variant="accent"
                    accentColor="amber"
                    size="sm"
                    icon={isEdit ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    disabled={!canSubmit}
                    onClick={handleSubmit}
                  >
                    {isEdit ? t.common.save : dp.new_project}
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          /* Post-creation step: offer context scan */
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <h2 className="typo-section-title mb-1">{dp.project_created}</h2>
            <p className="typo-caption text-foreground mb-6">
              <span className="font-medium text-foreground">{createdProject?.name}</span> {dp.project_ready_desc}
            </p>

            <div className="bg-primary/5 border border-primary/10 rounded-modal p-4 mb-6 text-left">
              <div className="flex items-start gap-3">
                <Search className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="typo-card-label mb-1">{dp.generate_context_map}</h4>
                  <p className="typo-caption text-foreground">{dp.generate_context_map_desc}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>{dp.skip_for_now}</Button>
              <Button variant="accent" accentColor="amber" size="sm" icon={<Search className="w-3.5 h-3.5" />} onClick={handleScanNow}>
                {dp.scan_codebase}
              </Button>
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
}

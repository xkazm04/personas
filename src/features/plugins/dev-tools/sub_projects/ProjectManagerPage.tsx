import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderKanban, Plus, ChevronRight, Folder, Network, Code2, Archive, CheckSquare, Square, X as XIcon, ExternalLink,
} from 'lucide-react';
import { openLocalPath, openExternalUrl } from '@/api/system/system';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from "@/stores/systemStore";
import { useContextScanBackground } from '../hooks/useContextScanBackground';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { CrossProjectMetadataModal } from './CrossProjectMetadataModal';
import { useTranslation } from '@/i18n/useTranslation';
import {
  type Project, type ProjectType, type EditProjectData,
  toProject, PROJECT_TYPES, StatusBadge,
} from './projectManagerTypes';
import { ProjectModal } from './ProjectModal';
import { ProjectRowMenu } from './ProjectManagerParts';
import { usePipelineStore } from '@/stores/pipelineStore';
import { Users } from 'lucide-react';
import { ProjectTeamPreviewModal } from './ProjectTeamPreviewModal';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProjectManagerPage() {
  const { t } = useTranslation();
  // Store bindings
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const storeProjects = useSystemStore((s) => s.projects);
  const storeCreateProject = useSystemStore((s) => s.createProject);
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const { startBackgroundScan } = useContextScanBackground();

  // Map store data into view-models. Goals are managed in the dedicated Goals
  // module (sub_goals), so the project list no longer tracks goal counts here.
  const projects: Project[] = storeProjects.map((p) => toProject(p, 0));
  const storeActiveProjectId = useSystemStore((s) => s.activeProjectId);

  // Teams roster for the bound-binding badges in the project table
  // (cycle 5). Fetched on mount so the pills resolve immediately without
  // per-row async lookups.
  const teamsList = usePipelineStore((s) => s.teams);
  const fetchTeamsForBadge = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { void fetchTeamsForBadge(); }, [fetchTeamsForBadge]);
  const teamNameById = new Map(teamsList.map((tm) => [tm.id, { name: tm.name, color: tm.color }]));
  const teamFullById = new Map<string, PersonaTeam>(teamsList.map((tm) => [tm.id, tm]));

  // Click-to-open team preview (cycle 11). Holds the team whose preview
  // modal is open; closing nulls it.
  const [previewingTeam, setPreviewingTeam] = useState<PersonaTeam | null>(null);
  const [activeProjectId, setLocalActiveProject] = useState<string | null>(storeActiveProjectId);
  const [showModal, setShowModal] = useState(false);
  const [showCrossProjectMap, setShowCrossProjectMap] = useState(false);
  const [editingProject, setEditingProject] = useState<EditProjectData | null>(null);

  // Bulk-archive selection — checkbox column + sticky action bar above the
  // table. Archive flows through updateProject({status: 'archived'}) per id
  // so it reuses the existing slice action and SQL repository path.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  const addToastPm = useToastStore((s) => s.addToast);
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const visibleNonArchivedIds = useMemo(
    () => projects.filter((p) => p.status !== 'archived').map((p) => p.id),
    [projects],
  );
  const allVisibleSelected = visibleNonArchivedIds.length > 0 && visibleNonArchivedIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) clearSelection();
    else setSelectedIds(new Set(visibleNonArchivedIds));
  }, [allVisibleSelected, visibleNonArchivedIds, clearSelection]);
  const bulkArchive = useCallback(async () => {
    if (selectedIds.size === 0 || archiving) return;
    setArchiving(true);
    let ok = 0, fail = 0;
    try {
      for (const id of selectedIds) {
        try {
          await storeUpdateProject(id, { status: 'archived' });
          ok++;
        } catch { fail++; }
      }
      if (ok > 0) addToastPm(t.plugins.dev_projects.bulk_archive_success.replace('{count}', String(ok)), 'success');
      if (fail > 0) addToastPm(t.plugins.dev_projects.bulk_archive_partial.replace('{failed}', String(fail)), 'error');
      clearSelection();
    } finally {
      setArchiving(false);
    }
  }, [selectedIds, archiving, storeUpdateProject, addToastPm, t.plugins.dev_projects.bulk_archive_success, t.plugins.dev_projects.bulk_archive_partial, clearSelection]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    fetchProjects?.();
  }, [fetchProjects]);

  // Sync local active with store (e.g., when project selector changes it)
  useEffect(() => {
    if (storeActiveProjectId && storeActiveProjectId !== activeProjectId) {
      setLocalActiveProject(storeActiveProjectId);
    }
  }, [activeProjectId, storeActiveProjectId]);

  const handleCreateProject = useCallback(async (data: { name: string; path: string; projectType: ProjectType; githubUrl: string; teamId: string | null; prCredentialId: string | null; testEnvUrl: string; testEnvBranch: string; mainBranch: string }) => {
    // If a project with this path already exists, activate it instead of creating a duplicate
    const existing = storeProjects.find((p) => p.root_path === data.path);
    if (existing) {
      setLocalActiveProject(existing.id);
      setActiveProject?.(existing.id);
      return { id: existing.id };
    }
    try {
      const project = await storeCreateProject(
        data.name,
        data.path,
        '',
        data.projectType,
        data.githubUrl || undefined,
        data.teamId ?? undefined,
      );
      // create_project doesn't accept pr-credential / test-env / main-branch
      // (they're post-creation source-control fields). Persist them — and the
      // mode-exclusive nulls — via a follow-up update so the pipeline's
      // Source-control stage survives creation.
      await storeUpdateProject(project.id, {
        teamId: data.teamId,
        prCredentialId: data.prCredentialId,
        testEnvUrl: data.testEnvUrl || null,
        testEnvBranch: data.testEnvBranch || null,
        mainBranch: data.mainBranch || null,
      });
      return { id: project.id };
    } catch {
      return undefined;
    }
  }, [storeCreateProject, storeUpdateProject, storeProjects, setActiveProject]);

  const handleUpdateProject = useCallback(async (id: string, data: { name: string; projectType: ProjectType; githubUrl: string; teamId: string | null; prCredentialId: string | null; testEnvUrl: string; testEnvBranch: string; mainBranch: string }) => {
    await storeUpdateProject(id, {
      name: data.name,
      techStack: data.projectType,
      githubUrl: data.githubUrl || undefined,
      teamId: data.teamId,
      prCredentialId: data.prCredentialId,
      // Empty string clears the living test-environment binding (Option<Option>).
      testEnvUrl: data.testEnvUrl || null,
      testEnvBranch: data.testEnvBranch || null,
      mainBranch: data.mainBranch || null,
    });
  }, [storeUpdateProject]);

  const handleEditProject = useCallback((projectId: string) => {
    const raw = storeProjects.find((p) => p.id === projectId);
    if (!raw) return;
    // Resolve projectType from tech_stack
    const techStackLower = (raw.tech_stack ?? '').toLowerCase();
    const matchedType = PROJECT_TYPES.find((pt) => pt.id === techStackLower);
    setEditingProject({
      id: raw.id,
      name: raw.name,
      path: raw.root_path,
      projectType: matchedType?.id ?? 'other',
      githubUrl: raw.github_url ?? '',
      teamId: raw.team_id ?? null,
      prCredentialId: raw.pr_credential_id ?? null,
      testEnvUrl: raw.test_env_url ?? '',
      testEnvBranch: raw.test_env_branch ?? '',
      mainBranch: raw.main_branch ?? '',
      standardsConfig: raw.standards_config ?? '',
    });
    setShowModal(true);
  }, [storeProjects]);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setEditingProject(null);
  }, []);

  const handleSetActive = useCallback((id: string) => {
    setLocalActiveProject(id);
    setActiveProject?.(id);
  }, [setActiveProject]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<FolderKanban className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.plugins.dev_tools.projects_title}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        <ActionRow>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={<Network className="w-3.5 h-3.5" />}
            onClick={() => setShowCrossProjectMap(true)}
            disabledReason={projects.length === 0 ? 'Create at least one project first' : undefined}
            disabled={projects.length === 0}
          >
            {t.plugins.dev_projects.cross_project_map_btn}
          </Button>
          <Button
            variant="accent"
            accentColor="amber"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => { setEditingProject(null); setShowModal(true); }}
            data-testid="dev-project-new"
          >
            {t.plugins.dev_projects.new_project}
          </Button>
        </ActionRow>

        <div className="space-y-6">
          {/* Active project — compact summary row for the selected project. */}
          {activeProject ? (
            <div className="animate-fade-slide-in border border-primary/10 rounded-2xl bg-gradient-to-br from-amber-500/5 to-transparent">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-modal bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <Folder className="w-4 h-4 text-amber-400" />
                </div>
                <h2 className="typo-section-title shrink-0">{activeProject.name}</h2>
                <span className="typo-caption text-foreground truncate min-w-0 flex-1">{activeProject.path}</span>
                {activeProject.techStack.length > 0 && (
                  <span className="typo-caption text-foreground shrink-0 hidden md:inline">
                    {activeProject.techStack.join(' · ')}
                  </span>
                )}
                <StatusBadge status={activeProject.status} />
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-primary/10 rounded-2xl p-8 text-center">
              <Folder className="w-8 h-8 text-foreground mx-auto mb-2" />
              <p className="typo-body text-foreground">{t.plugins.dev_projects.select_or_create}</p>
            </div>
          )}

          {/* Project list */}
          <div>
            <h3 className="typo-label font-semibold text-primary uppercase tracking-wider mb-3">
              {t.plugins.dev_projects.all_projects}({projects.length})
            </h3>

            {projects.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <FolderKanban className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="typo-body text-foreground mb-4">{t.plugins.dev_projects.no_projects_yet}</p>
                <Button
                  variant="accent"
                  accentColor="amber"
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => { setEditingProject(null); setShowModal(true); }}
                >
                  {t.plugins.dev_projects.create_first_project}
                </Button>
              </div>
            ) : (
              <div className="border border-primary/10 rounded-modal">
                {/* Bulk-action bar — only visible when something is selected */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/8 border-b border-amber-500/20">
                    <span className="typo-caption text-amber-300 font-medium tabular-nums">
                      {selectedIds.size} {selectedIds.size === 1 ? t.plugins.dev_projects.bulk_selected_one : t.plugins.dev_projects.bulk_selected_many}
                    </span>
                    <Button
                      variant="accent"
                      accentColor="amber"
                      size="xs"
                      icon={<Archive className="w-3 h-3" />}
                      loading={archiving}
                      onClick={bulkArchive}
                    >
                      {t.plugins.dev_projects.bulk_archive_btn}
                    </Button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="ml-auto inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground"
                    >
                      <XIcon className="w-3 h-3" /> {t.common.clear}
                    </button>
                  </div>
                )}

                {/* Table header */}
                <div className="grid grid-cols-[28px_1fr_1.2fr_0.8fr_0.6fr_0.7fr_110px] gap-3 px-4 py-2.5 bg-primary/5 border-b border-primary/10 typo-label font-medium text-primary uppercase tracking-wider rounded-t-modal">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleSelectAll(); }}
                    title={allVisibleSelected ? t.plugins.dev_projects.bulk_select_clear : t.plugins.dev_projects.bulk_select_all}
                    aria-label={allVisibleSelected ? t.plugins.dev_projects.bulk_select_clear : t.plugins.dev_projects.bulk_select_all}
                    className="self-center text-foreground hover:text-primary disabled:opacity-30"
                    disabled={visibleNonArchivedIds.length === 0}
                  >
                    {allVisibleSelected
                      ? <CheckSquare className="w-3.5 h-3.5" />
                      : <Square className="w-3.5 h-3.5" />}
                  </button>
                  <span>{t.plugins.dev_tools.col_name}</span>
                  <span>{t.plugins.dev_tools.col_path}</span>
                  <span>{t.plugins.dev_tools.col_tech_stack}</span>
                  <span>{t.plugins.dev_tools.col_status}</span>
                  <span>{t.plugins.dev_tools.col_created}</span>
                  <span></span>
                </div>
                {/* Table rows */}
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => handleSetActive(project.id)}
                    className={`grid grid-cols-[28px_1fr_1.2fr_0.8fr_0.6fr_0.7fr_110px] gap-3 px-4 py-3 border-b border-primary/5 last:border-b-0 cursor-pointer transition-colors ${
                      selectedIds.has(project.id)
                        ? 'bg-amber-500/5 ring-1 ring-amber-500/20'
                        : activeProjectId === project.id
                        ? 'bg-primary/10'
                        : 'hover:bg-primary/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleSelection(project.id); }}
                      disabled={project.status === 'archived'}
                      aria-label={t.plugins.dev_projects.bulk_select_row}
                      title={project.status === 'archived' ? t.plugins.dev_projects.bulk_already_archived : t.plugins.dev_projects.bulk_select_row}
                      className="self-center text-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {selectedIds.has(project.id)
                        ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                        : <Square className="w-3.5 h-3.5" />}
                    </button>
                    <span className="typo-body text-foreground font-medium flex items-center gap-2 truncate">
                      <ChevronRight className={`w-3.5 h-3.5 text-foreground transition-transform ${activeProjectId === project.id ? 'rotate-90' : ''}`} />
                      <span className="truncate">{project.name}</span>
                      {project.teamId && (() => {
                        const teamMeta = teamNameById.get(project.teamId);
                        const teamFull = teamFullById.get(project.teamId);
                        const baseClass =
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border typo-caption font-medium flex-shrink-0';
                        const style = teamMeta?.color
                          ? { backgroundColor: `${teamMeta.color}1a`, borderColor: `${teamMeta.color}66`, color: teamMeta.color }
                          : undefined;
                        if (teamFull) {
                          return (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setPreviewingTeam(teamFull); }}
                              className={`${baseClass} cursor-pointer hover:scale-105 active:scale-95 transition-transform`}
                              style={style}
                              title={t.plugins.dev_projects.team_binding_preview_title}
                            >
                              <Users className="w-3 h-3" />
                              {teamMeta?.name}
                            </button>
                          );
                        }
                        return (
                          <span
                            className={baseClass}
                            style={style}
                            title={t.plugins.dev_projects.team_binding_orphan}
                          >
                            <Users className="w-3 h-3" />
                            {t.plugins.dev_projects.team_binding_orphan_label}
                          </span>
                        );
                      })()}
                    </span>
                    <span className="typo-caption text-foreground truncate self-center">{project.path}</span>
                    <span className="typo-caption text-foreground truncate self-center">{project.techStack.join(', ')}</span>
                    <span className="self-center"><StatusBadge status={project.status} /></span>
                    <span className="typo-caption text-foreground self-center">{project.createdAt}</span>
                    <div className="self-center flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
                      {project.testEnvUrl && (
                        <button
                          type="button"
                          onClick={() => { openExternalUrl(project.testEnvUrl!).catch(toastCatch('ProjectCard:openTestEnv')); }}
                          title={t.plugins.dev_projects.open_test_env}
                          aria-label={t.plugins.dev_projects.open_test_env}
                          className="w-7 h-7 flex items-center justify-center rounded-interactive text-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { openLocalPath(`vscode://file/${project.path}`).catch(toastCatch('Failed to open in VS Code')); }}
                        title={t.plugins.dev_tools.row_open_vscode}
                        aria-label={t.plugins.dev_tools.row_open_vscode}
                        className="w-7 h-7 flex items-center justify-center rounded-interactive text-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { openLocalPath(project.path).catch(toastCatch('Failed to open project folder')); }}
                        title={t.plugins.dev_tools.row_open_folder}
                        aria-label={t.plugins.dev_tools.row_open_folder}
                        className="w-7 h-7 flex items-center justify-center rounded-interactive text-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Folder className="w-3.5 h-3.5" />
                      </button>
                      <ProjectRowMenu projectId={project.id} projectName={project.name} onEdit={() => handleEditProject(project.id)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContentBody>

      <ProjectModal
        open={showModal}
        onClose={handleCloseModal}
        onCreate={handleCreateProject}
        onUpdate={handleUpdateProject}
        onScanNow={startBackgroundScan}
        editProject={editingProject}
      />

      <CrossProjectMetadataModal
        open={showCrossProjectMap}
        onClose={() => setShowCrossProjectMap(false)}
      />

      {previewingTeam && (
        <ProjectTeamPreviewModal
          open
          team={previewingTeam}
          onClose={() => setPreviewingTeam(null)}
        />
      )}
    </ContentBox>
  );
}

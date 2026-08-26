import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderKanban, Plus, Folder, Network, Code2, Archive, CheckSquare, Square, X as XIcon, ExternalLink,
} from 'lucide-react';
import { openLocalPath, openExternalUrl } from '@/api/system/system';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
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
import { PersonaStack, usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useProjectTeamRosters } from './useProjectTeamRosters';
// Workspace layer above projects (tabs direction, chosen 2026-07-24): the
// strip files the page by workspace and the table keeps the full window width.
import { MoveToWorkspaceButton } from '../sub_workspaces/MoveToWorkspaceButton';
import { WorkspaceTabs } from '../sub_workspaces/WorkspaceTabs';
import { scopeProjects, setActiveWorkspace, useWorkspaces } from '../sub_workspaces/workspaceStore';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

/**
 * Loading choreography (docs/design/overview-loading.md v2): `projectsLoading`
 * (from `devToolsProjectSlice`) is handed to `UnifiedTable`, which owns the
 * whole cold-load contract — calm delayed ghost rows under its real column
 * header while the row region is empty and the fetch runs, the settled-only
 * empty state, and the id-guarded row cascade. A warm return visit already has
 * `projects` populated in the store and paints on the first frame regardless
 * of `projectsLoading`. The only local gate left is this page's rich
 * zero-projects CTA, which waits for the fetch to settle (law 5).
 */
export default function ProjectManagerPage() {
  const { t, tx } = useTranslation();
  // Store bindings
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const storeProjects = useSystemStore((s) => s.projects);
  // In-flight, nothing more (docs/design/overview-loading.md v2): gates ghost
  // rows ONLY into an empty region. Projects already in the store (warm
  // return visit) paint on the first frame regardless of this flag.
  const projectsLoading = useSystemStore((s) => s.projectsLoading);
  const storeCreateProject = useSystemStore((s) => s.createProject);
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const { startBackgroundScan } = useContextScanBackground();

  // Map store data into view-models. Goals are managed in the dedicated Goals
  // module (sub_goals), so the project list no longer tracks goal counts here.
  const allProjects: Project[] = storeProjects.map((p) => toProject(p, 0));
  const storeActiveProjectId = useSystemStore((s) => s.activeProjectId);

  // Workspace layer (prototype): the table, its counts and — critically — its
  // bulk selection all work off the SCOPED list. Select-all + bulk-archive
  // reaching projects from another workspace would be data loss.
  const { workspaces, activeId: activeWorkspaceId } = useWorkspaces();
  const projects = useMemo(
    () => scopeProjects(allProjects, workspaces, activeWorkspaceId),
    [allProjects, workspaces, activeWorkspaceId],
  );

  // Each dev project owns exactly ONE team, so the table's Members column is
  // the team: `fetchTeams()` fills BOTH `teams` and `teamCounts` in one pass,
  // which is where the member NUMBER comes from — no per-row IPC for it.
  const fetchTeamsForBadge = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { void fetchTeamsForBadge(); }, [fetchTeamsForBadge]);
  const teamCounts = usePipelineStore((s) => s.teamCounts);

  // ...and the persona ICONS come from one shared, batched roster cache keyed
  // by teamId (see useProjectTeamRosters). Distinct ids only, memoised so the
  // batch pass fires on a real change of the set and not on every render.
  const visibleTeamIds = useMemo(
    () => [...new Set(projects.map((p) => p.teamId).filter((id): id is string => !!id))].sort(),
    [projects],
  );
  const rosters = useProjectTeamRosters(visibleTeamIds);
  const personaIndex = usePersonaIndex();

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

  // Navigation contract into the team detail — the project's team IS the
  // Teams → Workspace surface. Store getState() rather than subscribing: this
  // fires from a click, and subscribing would re-render the table on every
  // unrelated selection change.
  const enterTeam = useCallback((teamId: string) => {
    usePipelineStore.getState().selectTeam(teamId);
    useSystemStore.getState().setTeamsTab('workspace');
  }, []);

  const handleSetActive = useCallback((id: string) => {
    setLocalActiveProject(id);
    setActiveProject?.(id);
  }, [setActiveProject]);

  // Shared-table columns. Every column renders at normal weight — the name
  // included (it was `typo-heading`/700 until the Projects consolidation; a
  // bold value in every row of a peer list emphasises nothing). Row actions,
  // the members button and the per-row / select-all checkboxes stop
  // propagation so they never trigger the row's set-active click.
  const columns: TableColumn<Project>[] = [
    {
      key: 'select',
      label: '',
      width: '40px',
      // Select-all lives in this column's header via filterComponent.
      filterComponent: (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleSelectAll(); }}
          title={allVisibleSelected ? t.plugins.dev_projects.bulk_select_clear : t.plugins.dev_projects.bulk_select_all}
          aria-label={allVisibleSelected ? t.plugins.dev_projects.bulk_select_clear : t.plugins.dev_projects.bulk_select_all}
          className="text-foreground hover:text-primary disabled:opacity-30"
          disabled={visibleNonArchivedIds.length === 0}
        >
          {allVisibleSelected
            ? <CheckSquare className="w-3.5 h-3.5" />
            : <Square className="w-3.5 h-3.5" />}
        </button>
      ),
      render: (project) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleSelection(project.id); }}
          disabled={project.status === 'archived'}
          aria-label={t.plugins.dev_projects.bulk_select_row}
          title={project.status === 'archived' ? t.plugins.dev_projects.bulk_already_archived : t.plugins.dev_projects.bulk_select_row}
          className="text-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {selectedIds.has(project.id)
            ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
            : <Square className="w-3.5 h-3.5" />}
        </button>
      ),
    },
    {
      key: 'name',
      label: t.plugins.dev_tools.col_name,
      width: 'minmax(180px, 1.4fr)',
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      // Normal weight, like the Teams table it replaces: the row is a list of
      // peers, and a bolded name in every row emphasises nothing. The team tag
      // that used to ride alongside is gone — the Members column below IS the
      // team now, and says something the tag never did (who is on it).
      render: (project) => (
        <span className="typo-body text-foreground flex items-center gap-2 min-w-0">
          <span className="truncate">{project.name}</span>
        </span>
      ),
    },
    {
      key: 'members',
      label: t.pipeline.team_studio.col_members,
      width: '120px',
      // The project's one team, rendered as its roster. Clicking enters the
      // team detail (Teams → Workspace). The row itself is a plain `div` with
      // an onClick (UnifiedTable), not a button — so a real <button> here is
      // valid markup; it just has to stop the row's set-active click.
      render: (project) => {
        const teamId = project.teamId;
        // Auto-created teams are backfilled asynchronously, so a project can
        // legitimately have no team yet. Inert em-dash, never a broken button.
        if (!teamId) {
          return <span className="typo-caption text-foreground opacity-40">&mdash;</span>;
        }
        const roster = rosters.get(teamId);
        // Count paints on the first frame from `teamCounts`; the roster refines
        // it once the batched fetch lands.
        const count = roster?.length ?? teamCounts[teamId]?.members ?? 0;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); enterTeam(teamId); }}
            aria-label={tx(count === 1 ? t.pipeline.team_studio.members_count_one : t.pipeline.team_studio.members_count_other, { count })}
            className="inline-flex items-center gap-1.5 h-7 px-1.5 rounded-interactive text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          >
            {roster && roster.length > 0
              ? <PersonaStack ids={[...roster]} index={personaIndex} max={3} />
              : <Users className={`w-3.5 h-3.5 ${count === 0 ? 'opacity-40' : ''}`} />}
            <span className={`typo-caption tabular-nums text-foreground ${count === 0 ? 'opacity-40' : ''}`}>{count}</span>
          </button>
        );
      },
    },
    {
      key: 'tech',
      label: t.plugins.dev_tools.col_tech_stack,
      width: 'minmax(100px, 0.9fr)',
      render: (project) => (
        <span className="typo-caption truncate block">{project.techStack.join(', ')}</span>
      ),
    },
    {
      key: 'status',
      label: t.plugins.dev_tools.col_status,
      width: '110px',
      render: (project) => <StatusBadge status={project.status} />,
    },
    {
      key: 'created',
      label: t.plugins.dev_tools.col_created,
      width: '110px',
      sortable: true,
      sortFn: (a, b) => a.createdAt.localeCompare(b.createdAt),
      render: (project) => (
        <span className="typo-caption">{project.createdAt}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '132px',
      align: 'right',
      render: (project) => (
        <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
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
      ),
    },
  ];

  // Rich zero-projects CTA is settled-only (law 5): while the cold-first-visit
  // fetch is in flight the table renders instead, and its own ghost rows fill
  // the empty region — so a fast fetch never flashes "no projects yet".
  const showRichEmpty = !projectsLoading && projects.length === 0;

  // Left-accent bar marks the active project (primary) or a bulk-selected row
  // (amber) — replaces the old full-row background tint.
  const rowAccent = (project: Project): string | undefined => {
    if (selectedIds.has(project.id)) return 'border-l-amber-400';
    if (activeProjectId === project.id) return 'border-l-primary';
    return undefined;
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<FolderKanban className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.plugins.dev_tools.projects_title}
        fitWidth
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        {/* One row, not two: the page actions ride in the workspace strip's
            `actions` slot so there is a single band of chrome above the table. */}
        <WorkspaceTabs
          projects={allProjects}
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          onSelect={setActiveWorkspace}
          actions={
            <>
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
            </>
          }
        />

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="typo-label font-semibold text-primary">
              {t.plugins.dev_projects.all_projects}({projects.length})
            </h3>
            {/* Bulk-action bar — inline, only when a row is selected. */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="typo-caption text-amber-300 font-medium tabular-nums">
                  {selectedIds.size} {selectedIds.size === 1 ? t.plugins.dev_projects.bulk_selected_one : t.plugins.dev_projects.bulk_selected_many}
                </span>
                <MoveToWorkspaceButton
                  workspaces={workspaces}
                  selectedIds={selectedIds}
                  onMoved={clearSelection}
                />
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
                  className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground"
                >
                  <XIcon className="w-3 h-3" /> {t.common.clear}
                </button>
              </div>
            )}
          </div>

          {showRichEmpty ? (
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
            <UnifiedTable<Project>
              columns={columns}
              data={projects}
              getRowKey={(p) => p.id}
              onRowClick={(p) => handleSetActive(p.id)}
              isLoading={projectsLoading}
              stickyHeader={false}
              ariaLabel={t.plugins.dev_projects.all_projects}
              rowAccent={rowAccent}
              rowReveal={{ resetKey: activeWorkspaceId ?? 'all' }}
            />
          )}
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

    </ContentBox>
  );
}

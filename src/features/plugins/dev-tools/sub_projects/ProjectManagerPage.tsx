import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderKanban, Plus, Folder, Network, Code2, Archive, CheckSquare, Square, X as XIcon, ExternalLink,
} from 'lucide-react';
import { openLocalPath, openExternalUrl } from '@/api/system/system';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
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
import { ProjectTeamPreviewModal } from './ProjectTeamPreviewModal';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
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
 * (from `devToolsProjectSlice`) gates ghost rows ONLY into an empty region
 * (`projectsLoading && projects.length === 0`); a warm return visit already
 * has `projects` populated in the store and paints on the first frame
 * regardless of `projectsLoading`. `UnifiedTable` owns header + row rendering
 * as a single opaque unit (no prop to inject a per-row `RevealItem` cascade or
 * to split header from body) — same shape as `LlmCallsTable`'s `CallsGhostRows`
 * — so the recipe's row-cascade step is a reported gap here rather than
 * hacked in: rows render instantly the frame they arrive (law 2), which is
 * the actual requirement; only the entrance ripple is missing. The ghost also
 * mimics the table's shape (header band + rows) instead of reusing
 * UnifiedTable's real interactive header, for the same reason. This table has
 * no `tableId`, so it isn't user-resizable — the ghost's grid template is
 * built from the same static per-column width strings as `columns` below
 * rather than `useColumnWidths` (there is no persisted-width state to share).
 */
export default function ProjectManagerPage() {
  const { t } = useTranslation();
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

  // Shared-table columns. Only the project name is bold; every other column is
  // rendered at normal weight per the data-density pass. Row actions and the
  // per-row / select-all checkboxes stop propagation so they never trigger the
  // row's set-active click.
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
      render: (project) => (
        // typo-heading carries font-weight:700 and is defined un-layered, so it
        // wins over the Tailwind weight utilities (which lose to the un-layered
        // typo-* classes). This makes the name the genuinely-heaviest cell; the
        // other columns stay on muted typo-caption (500) so they read lighter.
        <span className="typo-heading text-foreground flex items-center gap-2 min-w-0">
          <span className="truncate">{project.name}</span>
          {project.teamId && (() => {
            const teamMeta = teamNameById.get(project.teamId);
            const teamFull = teamFullById.get(project.teamId);
            const baseClass =
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border typo-caption font-normal flex-shrink-0';
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
      ),
    },
    {
      key: 'path',
      label: t.plugins.dev_tools.col_path,
      width: 'minmax(160px, 1.6fr)',
      render: (project) => (
        <span className="typo-caption truncate block">{project.path}</span>
      ),
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

  // Row region gate (docs/design/overview-loading.md v2): ghost rows ONLY
  // into an empty region while a fetch is in flight — a cold first visit
  // (projects fetched lazily via runStartup's non-devtools path). A warm
  // return visit has `projects` already populated by the time this mounts,
  // so `showGhost` is false and the real table paints frame-1. The
  // settled-empty state below only renders once `projectsLoading` has
  // resolved to false, so a fast fetch never flashes "no projects yet".
  const showGhost = projectsLoading && projects.length === 0;

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

        <WorkspaceTabs
          projects={allProjects}
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          onSelect={setActiveWorkspace}
        />

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="typo-label font-semibold text-primary uppercase tracking-wider">
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

          {showGhost ? (
            /* Cold first visit, fetch in flight, nothing on screen yet: calm
               ghost table under the mimicked column geometry (see
               ProjectGhostRows below). Invisible for its first ~120ms
               (animation-delay + fill-mode: both) so a fast fetch skips it
               entirely; the real UnifiedTable replaces it the frame data
               arrives — no gate, no held content (law 2). */
            <ProjectGhostRows />
          ) : projects.length === 0 ? (
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
              rowAccent={rowAccent}
              stickyHeader={false}
              ariaLabel={t.plugins.dev_projects.all_projects}
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

// ---------------------------------------------------------------------------
// ProjectGhostRows — calm ghost table for the ONLY moment the row region has
// nothing to show (a cold first visit with a fetch in flight).
//
// Each ghost enters via `animate-fade-in` (150ms, fill-mode: both) behind a
// staggered animation-delay starting at 120ms — `both` holds opacity 0 through
// the delay, so a fetch that resolves quickly never paints a single ghost.
// Mirrors the real 7-column grid (select/name/path/tech/status/created/
// actions) — same width strings as the `columns` memo above — so the
// ghost-to-content swap moves nothing. No `animate-pulse` — the entrance
// stagger is the only motion.
// ---------------------------------------------------------------------------

const PROJECT_GHOST_GRID = [
  '40px',
  'minmax(180px, 1.4fr)',
  'minmax(160px, 1.6fr)',
  'minmax(100px, 0.9fr)',
  '110px',
  '110px',
  '132px',
].join(' ');

const GHOST_ROW_HEIGHT = 44;
const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so the name column reads as rows, not a barcode. */
const GHOST_NAME_WIDTHS = ['w-36', 'w-28', 'w-32', 'w-24'];

function ProjectGhostRows() {
  return (
    <div className="border border-primary/10 rounded-modal overflow-hidden" aria-hidden="true">
      <div
        className="grid border-b border-primary/10 bg-primary/5 px-0 py-2.5 animate-fade-in"
        style={{ gridTemplateColumns: PROJECT_GHOST_GRID, animationDelay: '120ms' }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} className="px-4">
            <span className={`h-2.5 w-10 block ${GHOST_BAR} ${i >= 4 ? 'ml-auto' : ''}`} />
          </span>
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, i) => {
        const nameW = GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length];
        const delay = `${140 + i * 35}ms`;
        return (
          <div
            key={i}
            className="grid items-center px-0 border-t border-t-primary/10 animate-fade-in"
            style={{ gridTemplateColumns: PROJECT_GHOST_GRID, height: GHOST_ROW_HEIGHT, animationDelay: delay }}
          >
            <span className="px-4">
              <span className={`h-3.5 w-3.5 block ${GHOST_BAR}`} />
            </span>
            <span className="px-4">
              <span className={`h-3.5 ${nameW} max-w-full block ${GHOST_BAR}`} />
            </span>
            <span className="px-4">
              <span className={`h-3.5 w-24 block ${GHOST_BAR}`} />
            </span>
            <span className="px-4">
              <span className={`h-3.5 w-16 block ${GHOST_BAR}`} />
            </span>
            <span className="px-4">
              <span className={`h-3.5 w-14 block ${GHOST_BAR}`} />
            </span>
            <span className="px-4">
              <span className={`h-3.5 w-14 ml-auto block ${GHOST_BAR}`} />
            </span>
            <span className="px-4">
              <span className={`h-3.5 w-20 ml-auto block ${GHOST_BAR}`} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

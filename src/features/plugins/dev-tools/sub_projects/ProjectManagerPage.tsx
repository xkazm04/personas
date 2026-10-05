// MANAGE - the projects table.
//
// This file was 591 lines holding store bindings, workspace scoping, three
// batched caches, bulk selection, six handlers and a ten-column table in one
// function. 2026-10-05 it became a shell over four extracted units
// (`useProjectManagerData`, `useProjectSelection`, `useProjectManagerActions`,
// `buildProjectColumns` + `projectTableCells`), each under the repo's 200-line
// ceiling.
//
// THE WORKSPACE STRIP IS GONE. `WorkspaceTabs` filed the page by workspace with
// a horizontal tab strip - the same selection, over the same `workspaceStore`,
// that the app header's `WorkspaceProjectSelector` already offers globally, with
// the same counts and the same "new workspace" action. Two controls for one
// piece of state is one too many; the header's survives because it is reachable
// from every surface. Its one NON-duplicated affordance, the per-workspace
// rename / recolour / delete menu, moved into that selector's own workspace rows
// in the same change, so nothing was lost with the strip.
//
// The two page actions it hosted now ride in `ContentHeader`'s `actions` slot,
// which is where page-scoped controls belong and removes a whole band of chrome
// above the table.
import { useState } from 'react';
import { FolderKanban, Network, Plus } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { UnifiedTable } from '@/features/shared/components/display/UnifiedTable';
import { Button } from '@/features/shared/components/buttons';

import { useContextScanBackground } from '../hooks/useContextScanBackground';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { CrossProjectMetadataModal } from './CrossProjectMetadataModal';
import { ProjectModal } from './ProjectModal';
import type { Project } from './projectManagerTypes';
import { buildProjectColumns } from './projectColumns';
import { ProjectsBulkBar } from './projectTableCells';
import { useProjectManagerData } from './useProjectManagerData';
import { useProjectManagerActions } from './useProjectManagerActions';
import { useProjectSelection } from './useProjectSelection';

/**
 * Loading choreography (docs/design/overview-loading.md v2): `projectsLoading`
 * is handed to `UnifiedTable`, which owns the whole cold-load contract - calm
 * delayed ghost rows under its real column header while the row region is empty
 * and the fetch runs, the settled-only empty state, and the id-guarded row
 * cascade. A warm return visit already has `projects` in the store and paints on
 * the first frame regardless of `projectsLoading`. The only local gate left is
 * this page's rich zero-projects CTA, which waits for the fetch to settle
 * (law 5).
 */
export default function ProjectManagerPage() {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  const { startBackgroundScan } = useContextScanBackground();
  const [showCrossProjectMap, setShowCrossProjectMap] = useState(false);

  const data = useProjectManagerData();
  const { projects, projectsLoading, workspaces, activeWorkspaceId } = data;
  const selection = useProjectSelection(projects, {
    success: dp.bulk_archive_success,
    partial: dp.bulk_archive_partial,
  });
  const actions = useProjectManagerActions(data.storeActiveProjectId);

  const columns = buildProjectColumns({
    t,
    selectedIds: selection.selectedIds,
    allSelected: selection.allSelected,
    selectableCount: selection.selectableIds.length,
    onToggleSelection: selection.toggleSelection,
    onToggleSelectAll: selection.toggleSelectAll,
    rosters: data.rosters,
    personaIndex: data.personaIndex,
    teamCounts: data.teamCounts,
    pulses: data.pulses,
    onEnterTeam: actions.enterTeam,
    onEditProject: actions.handleEditProject,
  });

  // Rich zero-projects CTA is settled-only (law 5): while the cold-first-visit
  // fetch is in flight the table renders instead, and its own ghost rows fill
  // the empty region - so a fast fetch never flashes "no projects yet".
  const showRichEmpty = !projectsLoading && projects.length === 0;

  // Left-accent bar marks the active project (primary) or a bulk-selected row
  // (amber) - replaces the old full-row background tint.
  const rowAccent = (project: Project): string | undefined => {
    if (selection.selectedIds.has(project.id)) return 'border-l-amber-400';
    if (actions.activeProjectId === project.id) return 'border-l-primary';
    return undefined;
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<FolderKanban className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.plugins.dev_tools.projects_title}
        fitWidth
        actions={
          <>
            <LifecycleProjectPicker />
            <Button
              variant="accent"
              tone="agent"
              size="sm"
              icon={<Network className="w-3.5 h-3.5" />}
              onClick={() => setShowCrossProjectMap(true)}
              disabled={projects.length === 0}
              disabledReason={projects.length === 0 ? dp.no_projects_yet : undefined}
            >
              {dp.cross_project_map_btn}
            </Button>
            <Button
              variant="accent"
              tone="warning"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={actions.openNewProject}
              data-testid="dev-project-new"
            >
              {dp.new_project}
            </Button>
          </>
        }
      />

      <ContentBody>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="typo-label text-primary">{dp.all_projects}({projects.length})</h3>
            {selection.selectedIds.size > 0 && (
              <ProjectsBulkBar
                count={selection.selectedIds.size}
                workspaces={workspaces}
                selectedIds={selection.selectedIds}
                archiving={selection.archiving}
                onArchive={selection.bulkArchive}
                onClear={selection.clearSelection}
              />
            )}
          </div>

          {showRichEmpty ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                <FolderKanban className="w-7 h-7 text-amber-400/50" />
              </div>
              <p className="typo-body text-foreground mb-4">{dp.no_projects_yet}</p>
              <Button
                variant="accent"
                tone="warning"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={actions.openNewProject}
              >
                {dp.create_first_project}
              </Button>
            </div>
          ) : (
            <UnifiedTable<Project>
              columns={columns}
              data={projects}
              getRowKey={(p) => p.id}
              onRowClick={(p) => actions.handleSetActive(p.id)}
              isLoading={projectsLoading}
              stickyHeader={false}
              ariaLabel={dp.all_projects}
              rowAccent={rowAccent}
              rowReveal={{ resetKey: activeWorkspaceId ?? 'all' }}
              defaultSortKey="name"
              defaultSortDir="asc"
            />
          )}
        </div>
      </ContentBody>

      <ProjectModal
        open={actions.showModal}
        onClose={actions.handleCloseModal}
        onCreate={actions.handleCreateProject}
        onUpdate={actions.handleUpdateProject}
        onScanNow={startBackgroundScan}
        editProject={actions.editingProject}
      />

      <CrossProjectMetadataModal
        open={showCrossProjectMap}
        onClose={() => setShowCrossProjectMap(false)}
      />
    </ContentBox>
  );
}

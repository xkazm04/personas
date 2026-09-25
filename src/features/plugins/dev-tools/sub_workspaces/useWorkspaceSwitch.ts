// Shared by every workspace-switcher variant.
//
// The load-bearing part is the RE-VALIDATION: `activeProjectId` is persisted
// (systemStore partialize) and is never checked against the workspace, so
// switching workspaces while a foreign project stays active would leave every
// dev-tools surface acting on a project the user can no longer see. Switching
// therefore re-points the active project into the new workspace (first member)
// or clears it.
import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { codeProjectsOnly } from '@/lib/devProjectKind';
import { useSystemStore } from '@/stores/systemStore';

import { scopeProjects, setActiveWorkspace, useWorkspaces, workspaceOf } from './workspaceStore';

export function useWorkspaceSwitch() {
  const projects = useSystemStore(useShallow((s) => s.projects));
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const { workspaces, activeId } = useWorkspaces();

  /** Projects visible under the active workspace (all of them when None).
   *
   *  Registry checkouts are not offered here. This switcher sets
   *  `activeProjectId`, which is what the KPI scan, the use-case scan, the
   *  context map, Lifecycle and the Features board all act on — making a
   *  knowledge repo "the project" would point every one of them at a
   *  codebase that is not one. Dispatch pickers (Fleet quick-dispatch, the
   *  Notepad) read `projects` and still see it. */
  const scoped = useMemo(
    () => codeProjectsOnly(scopeProjects(projects, workspaces, activeId)),
    [projects, workspaces, activeId],
  );

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  );

  const switchWorkspace = useCallback((id: string | null) => {
    setActiveWorkspace(id);
    if (!id) return; // "All projects" — every project stays in scope
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    if (activeProjectId && ws.projectIds.includes(activeProjectId)) return; // already in scope
    const first = projects.find((p) => ws.projectIds.includes(p.id)) ?? null;
    void setActiveProject(first?.id ?? null);
  }, [workspaces, projects, activeProjectId, setActiveProject]);

  /** The workspace the ACTIVE project belongs to — what a breadcrumb shows. */
  const projectWorkspace = useMemo(
    () => (activeProjectId ? workspaceOf(workspaces, activeProjectId) : null),
    [workspaces, activeProjectId],
  );

  return {
    projects, scoped, workspaces, activeId, activeProjectId,
    activeProject, activeWorkspace, projectWorkspace,
    setActiveProject, switchWorkspace,
  };
}

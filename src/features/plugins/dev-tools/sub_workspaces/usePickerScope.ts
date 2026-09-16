import { useMemo } from 'react';
import { useWorkspaceSwitch } from './useWorkspaceSwitch';

/**
 * The scope the workspace / project selector currently names, as a filter:
 * the active project when one is picked, otherwise the active workspace's
 * projects, otherwise everything (`projectIds === null`). Pages that list
 * cross-project data (Goals, KPIs) use it as their default filter so the
 * header picker and the rows below it can never disagree.
 */
export interface PickerScope {
  kind: 'project' | 'workspace' | 'all';
  /** Set only for `kind === 'project'`. */
  projectId: string | null;
  /** `null` means unscoped — every project passes. */
  projectIds: ReadonlySet<string> | null;
  /** Stable identity of the scope, for reveal / scroll reset keys. */
  key: string;
}

export function usePickerScope(): PickerScope {
  const { activeProjectId, activeWorkspace } = useWorkspaceSwitch();
  return useMemo<PickerScope>(() => {
    if (activeProjectId) {
      return { kind: 'project', projectId: activeProjectId, projectIds: new Set([activeProjectId]), key: `project:${activeProjectId}` };
    }
    if (activeWorkspace) {
      return { kind: 'workspace', projectId: null, projectIds: new Set(activeWorkspace.projectIds), key: `workspace:${activeWorkspace.id}` };
    }
    return { kind: 'all', projectId: null, projectIds: null, key: 'all' };
  }, [activeProjectId, activeWorkspace]);
}

/** Does a row owned by `projectId` fall inside the scope? */
export function inPickerScope(scope: PickerScope, projectId: string): boolean {
  return scope.projectIds === null || scope.projectIds.has(projectId);
}

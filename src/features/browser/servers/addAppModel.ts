// Which projects Add app offers, and how they are grouped. Pure, so the
// picker's rules (code projects only, not already in the view, grouped by
// workspace in the workspace store's order, "No workspace" last) are testable
// without a store.

import type { DevProject } from '@/lib/bindings/DevProject';
import { codeProjectsOnly } from '@/lib/devProjectKind';
import { matchesQuery } from '@/lib/text/search';

export interface PickerWorkspace {
  id: string;
  name: string;
  color: string;
}

export interface PickerGroup {
  /** null = projects in no workspace. */
  workspace: PickerWorkspace | null;
  projects: DevProject[];
}

const byName = (a: DevProject, b: DevProject) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * The candidates for Add app: code projects not already in Server control,
 * matching `query` on name or path, grouped by their workspace.
 */
export function addAppGroups(
  projects: readonly DevProject[],
  workspaces: readonly PickerWorkspace[],
  inView: ReadonlySet<string>,
  query: string,
): PickerGroup[] {
  const candidates = codeProjectsOnly([...projects])
    .filter((p) => !inView.has(p.id))
    .filter((p) => !query.trim() || matchesQuery(`${p.name} ${p.root_path}`, query))
    .sort(byName);
  const known = new Set(workspaces.map((w) => w.id));
  const groups: PickerGroup[] = workspaces.map((w) => ({
    workspace: w,
    projects: candidates.filter((p) => p.workspace_id === w.id),
  }));
  groups.push({ workspace: null, projects: candidates.filter((p) => !p.workspace_id || !known.has(p.workspace_id)) });
  return groups.filter((g) => g.projects.length > 0);
}

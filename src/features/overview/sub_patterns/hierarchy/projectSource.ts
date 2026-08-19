// The ONE persistence point for "which managed repo is the knowledge source".
// Both hierarchy lanes (Subjects master–detail and the hierarchy graph) read
// and write the same key so switching lanes never switches corpora.
import { silentCatch } from '@/lib/silentCatch';

export const HIERARCHY_PROJECT_KEY = 'patterns:hierarchy-project';

/** Validated read of the persisted source project — a stale id (project
 *  deleted since) falls back to the first project rather than a dead view. */
export function initialHierarchyProjectId(projectIds: string[]): string | null {
  try {
    const stored = localStorage.getItem(HIERARCHY_PROJECT_KEY);
    if (stored && projectIds.includes(stored)) return stored;
  } catch (err) {
    // localStorage unavailable — fall through to the default.
    silentCatch('patterns:hierarchyProjectRead')(err);
  }
  return projectIds[0] ?? null;
}

export function persistHierarchyProjectId(id: string): void {
  try {
    localStorage.setItem(HIERARCHY_PROJECT_KEY, id);
  } catch (err) {
    // Persistence is a convenience, never a blocker.
    silentCatch('patterns:hierarchyProjectWrite')(err);
  }
}

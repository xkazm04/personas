// Workspaces API — wrappers over the dev_tools_workspace_* Tauri commands.
// Workspaces group dev projects (single workspace per project via
// dev_projects.workspace_id).
//
// The in-app Workspace Knowledge library (practices, adoption matrix,
// playbooks, harvest, divergence, verification, projection) that used to live
// behind this module was retired: the external ai-registry is the knowledge
// authority, read by the Patterns lanes rather than ingested into SQLite.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevProject } from "@/lib/bindings/DevProject";
import type { DevWorkspace } from "@/lib/bindings/DevWorkspace";
import type { WorkspaceImportItem } from "@/lib/bindings/WorkspaceImportItem";

export async function listWorkspaces(): Promise<DevWorkspace[]> {
  return invoke<DevWorkspace[]>("dev_tools_workspace_list", {});
}

export async function createWorkspace(
  name: string,
  color?: string,
  description?: string,
  adoptDefaultSkills?: boolean,
): Promise<DevWorkspace> {
  return invoke<DevWorkspace>("dev_tools_workspace_create", {
    name, color, description, adoptDefaultSkills,
  });
}

/** Field-wise update. `null` clears a nullable column; `undefined` leaves it unchanged. */
export async function updateWorkspace(
  id: string,
  patch: { name?: string; color?: string | null; description?: string | null },
): Promise<DevWorkspace> {
  return invoke<DevWorkspace>("dev_tools_workspace_update", { id, ...patch });
}

/** Delete a workspace. Member projects are unassigned, never deleted. */
export async function deleteWorkspace(id: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_workspace_delete", { id });
}

/** Move a project into a workspace (or out of every one when `null`). */
export async function assignProjectToWorkspace(
  projectId: string,
  workspaceId: string | null,
): Promise<DevProject> {
  return invoke<DevProject>("dev_tools_workspace_assign_project", { projectId, workspaceId });
}

/** One-time import of the localStorage prototype (idempotent on name). */
export async function importLocalWorkspaces(
  items: WorkspaceImportItem[],
): Promise<DevWorkspace[]> {
  return invoke<DevWorkspace[]>("dev_tools_workspace_import_local", { items });
}

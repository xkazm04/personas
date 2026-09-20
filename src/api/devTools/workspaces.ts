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

// ============================================================================
// The active-workspace mirror
// ============================================================================

/**
 * Record which workspace the operator is standing in, or clear it with `null`.
 *
 * The selection itself stays in `localStorage` — it is a per-device UI
 * preference — and this is the one-way copy the BACKEND reads: a hiring door
 * with no project in its payload has no other way to learn which organisation
 * a new persona belongs to. Nothing reads it back into the UI, so callers fire
 * it and forget it; a failed write costs a filing, never a switch.
 *
 * Deliberately a command rather than a `setAppSetting` call with a key string:
 * the key name then exists once, in the backend registry that owns it, instead
 * of twice with a comment between them.
 */
export async function mirrorActiveWorkspace(workspaceId: string | null): Promise<void> {
  return invoke<void>("dev_tools_workspace_set_active", { workspaceId });
}

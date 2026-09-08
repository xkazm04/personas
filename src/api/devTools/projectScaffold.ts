// One-step repository + project creation — the Tauri half of the
// `POST /dev-tools/projects/create` bridge route, and the workspace
// never-delete tag that guards what it builds.
//
// `createProject` in ./devTools registers a directory that ALREADY exists.
// This command creates the repository too: it computes
// `<root>/<workspace-slug>/<name>` under the `simulation_projects_root`
// setting (default `<app data dir>/sim`), `git init`s it, writes a README, a
// .gitignore and the template's skeleton, makes one commit, then registers the
// project and assigns it to the workspace. Backend:
// src-tauri/src/commands/infrastructure/project_scaffold.rs.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CreateProjectRepositoryInput } from "@/lib/bindings/CreateProjectRepositoryInput";
import type { CreatedProjectRepository } from "@/lib/bindings/CreatedProjectRepository";
import type { ProjectTemplate } from "@/lib/bindings/ProjectTemplate";

export type { CreateProjectRepositoryInput, CreatedProjectRepository, ProjectTemplate };

/**
 * Create a repository and register it as a project in one call.
 *
 * `workspace` is a workspace id or a name; a name that matches nothing creates
 * the workspace. Refuses (`AppError::Validation`) when the target directory
 * exists and is not empty — unless it already carries `.personas/project.json`,
 * in which case the call is idempotent and returns the SAME project with
 * `created: false`.
 */
export async function createProjectRepository(
  input: CreateProjectRepositoryInput,
): Promise<CreatedProjectRepository> {
  return invoke<CreatedProjectRepository>("create_project_repository", { input });
}

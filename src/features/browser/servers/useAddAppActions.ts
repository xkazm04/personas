// Add app's two doors: put an EXISTING workspace project into Server control,
// or create a project through the shared ProjectModal and put it in at once.
// Both end in `dev_server_add_app`, which assigns a free port and starts the
// AI scan; the row then arrives through `dev-servers-changed` as `scanning`.
//
// Creation follows the Projects manager's own path (`useProjectManagerActions`):
// store createProject, then the source-control fields create_project does not
// take, and a project already at that path is reused, never duplicated.

import { useCallback } from 'react';

import * as api from '@/api/devServers';
import type { ProjectFormData } from '@/features/plugins/dev-tools/sub_projects/useProjectManagerActions';
import type { DevProject } from '@/lib/bindings/DevProject';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

export function useAddAppActions() {
  const createProject = useSystemStore((s) => s.createProject);
  const updateProject = useSystemStore((s) => s.updateProject);

  /** Throws the refusal so the picker can show it. */
  const addProject = useCallback(async (project: DevProject) => {
    await api.addDevServerApp(project.root_path, project.workspace_id);
  }, []);

  /** ProjectModal's `onCreate`: `undefined` keeps the modal open on failure. */
  const createAndAdd = useCallback(
    async (data: ProjectFormData): Promise<{ id: string } | undefined> => {
      const existing = useSystemStore.getState().projects.find((p) => p.root_path === data.path);
      try {
        const project =
          existing ??
          (await createProject(data.name, data.path, '', data.projectType, data.githubUrl || undefined, data.teamId ?? undefined));
        if (!existing) {
          await updateProject(project.id, {
            teamId: data.teamId,
            prCredentialId: data.prCredentialId,
            testEnvUrl: data.testEnvUrl || null,
            testEnvBranch: data.testEnvBranch || null,
            mainBranch: data.mainBranch || null,
          });
        }
        await api.addDevServerApp(project.root_path, project.workspace_id);
        return { id: project.id };
      } catch (err) {
        silentCatch('browser/servers:createAndAdd')(err);
        return undefined;
      }
    },
    [createProject, updateProject],
  );

  return { addProject, createAndAdd };
}

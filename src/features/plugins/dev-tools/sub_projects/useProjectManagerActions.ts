// Create / update / edit / activate for the Manage page.
//
// Extracted from `ProjectManagerPage` 2026-10-05. These are the acts the table
// and its modal trigger; none of them render anything.
import { useCallback, useEffect, useState } from 'react';

import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';

import { PROJECT_TYPES, type EditProjectData, type ProjectType } from './projectManagerTypes';

/** The project fields the modal submits, for both create and update. */
export interface ProjectFormData {
  name: string;
  path: string;
  projectType: ProjectType;
  githubUrl: string;
  teamId: string | null;
  prCredentialId: string | null;
  testEnvUrl: string;
  testEnvBranch: string;
  mainBranch: string;
}

export function useProjectManagerActions(storeActiveProjectId: string | null) {
  const storeProjects = useSystemStore((s) => s.projects);
  const storeCreateProject = useSystemStore((s) => s.createProject);
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);

  const [activeProjectId, setLocalActiveProject] = useState<string | null>(storeActiveProjectId);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<EditProjectData | null>(null);

  // Sync local active with the store (e.g. when the global project selector
  // changes it from the app header).
  useEffect(() => {
    if (storeActiveProjectId && storeActiveProjectId !== activeProjectId) {
      setLocalActiveProject(storeActiveProjectId);
    }
  }, [activeProjectId, storeActiveProjectId]);

  const handleCreateProject = useCallback(async (data: ProjectFormData) => {
    // A project already at this path is activated, never duplicated.
    const existing = storeProjects.find((p) => p.root_path === data.path);
    if (existing) {
      setLocalActiveProject(existing.id);
      setActiveProject?.(existing.id);
      return { id: existing.id };
    }
    try {
      const project = await storeCreateProject(
        data.name, data.path, '', data.projectType,
        data.githubUrl || undefined, data.teamId ?? undefined,
      );
      // create_project does not accept pr-credential / test-env / main-branch
      // (they are post-creation source-control fields). Persist them - and the
      // mode-exclusive nulls - via a follow-up update so the pipeline's
      // Source-control stage survives creation.
      await storeUpdateProject(project.id, {
        teamId: data.teamId,
        prCredentialId: data.prCredentialId,
        testEnvUrl: data.testEnvUrl || null,
        testEnvBranch: data.testEnvBranch || null,
        mainBranch: data.mainBranch || null,
      });
      return { id: project.id };
    } catch (err) {
      // The modal reports the failure to the user by staying open on an
      // undefined return; the ERROR itself still has to reach a door, or the
      // only evidence of a failed create is destroyed here
      // (`docs/concepts/golden-paths/swallowed-error-telemetry.md`).
      silentCatch('ProjectManager:createProject')(err);
      return undefined;
    }
  }, [storeCreateProject, storeUpdateProject, storeProjects, setActiveProject]);

  const handleUpdateProject = useCallback(async (id: string, data: Omit<ProjectFormData, 'path'>) => {
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

  const openNewProject = useCallback(() => { setEditingProject(null); setShowModal(true); }, []);
  const handleCloseModal = useCallback(() => { setShowModal(false); setEditingProject(null); }, []);

  // Navigation contract into the team detail - the project's team IS the
  // Teams -> Workspace surface. `getState()` rather than subscribing: this
  // fires from a click, and subscribing would re-render the table on every
  // unrelated selection change.
  const enterTeam = useCallback((teamId: string) => {
    usePipelineStore.getState().selectTeam(teamId);
    useSystemStore.getState().setTeamsTab('workspace');
  }, []);

  const handleSetActive = useCallback((id: string) => {
    setLocalActiveProject(id);
    setActiveProject?.(id);
  }, [setActiveProject]);

  return {
    activeProjectId, showModal, editingProject,
    handleCreateProject, handleUpdateProject, handleEditProject,
    openNewProject, handleCloseModal, enterTeam, handleSetActive,
  };
}

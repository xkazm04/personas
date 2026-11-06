/**
 * console-style fan-out, partition B: harness entries for this partition's pages.
 * Owned by the partition-B builder; registry.tsx spreads it (wired by the Director).
 *
 *   plugins/dev-tools/project-manager  the projects table (ProjectManagerPage)
 *   plugins/dev-tools/context-map      the context map tab (ContextMapPage)
 *   plugins/dev-tools/task-runner      the Run Desk (RunDeskPage)
 *   projects/goals                     Goals (GoalsPage), cross-project scope
 *
 * Already registered elsewhere and reused: plugins/dev-tools-overview,
 * plugins/lifecycle/portfolio, fleet/grid, fleet/activity.
 */
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

const PROJECT = 'p-atlas';

async function quietly(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[page-harness] prepare step "${label}" failed`, err);
  }
}

async function prepareProjects(devToolsTab: 'overview' | 'context-map' | 'task-runner' | 'fleet' | 'llm-overview' | 'workspaces' | 'skills' = 'overview') {
  useSystemStore.setState({ sidebarSection: 'plugins', devToolsTab });
  await quietly('fetchProjects', () => useSystemStore.getState().fetchProjects());
  useSystemStore.setState({ activeProjectId: PROJECT });
}

export const FANOUT_B_MODULES: Record<string, HarnessModule> = {
  'plugins/dev-tools/project-manager': {
    load: () => import('@/features/plugins/dev-tools/sub_projects/ProjectManagerPage'),
    prepare: () => prepareProjects(),
  },
  'plugins/dev-tools/context-map': {
    load: () => import('@/features/plugins/dev-tools/sub_context/ContextMapPage'),
    prepare: () => prepareProjects('context-map'),
  },
  'plugins/dev-tools/task-runner': {
    load: () => import('@/features/plugins/dev-tools/sub_runner/RunDeskPage'),
    prepare: () => prepareProjects('task-runner'),
  },
  'plugins/dev-tools/skills': {
    load: () => import('@/features/plugins/dev-tools/sub_skills/SkillsManagerPage'),
    prepare: () => prepareProjects('skills'),
  },
  'plugins/dev-tools/workspaces': {
    load: () => import('@/features/plugins/dev-tools/sub_workspaces/WorkspacesPage'),
    prepare: () => prepareProjects('workspaces'),
  },
  'plugins/dev-tools/llm-overview': {
    load: () => import('@/features/plugins/dev-tools/sub_llm_overview/LlmOverviewPage'),
    prepare: () => prepareProjects('llm-overview'),
  },
  'projects/goals': {
    load: () => import('@/features/projects/development/goals/GoalsPage'),
    prepare: async () => {
      useSystemStore.setState({ sidebarSection: 'teams' });
      await quietly('fetchProjects', () => useSystemStore.getState().fetchProjects());
      useSystemStore.setState({ activeProjectId: PROJECT });
    },
  },
};

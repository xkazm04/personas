// The Manage table's DATA, with no view in it.
//
// Extracted from `ProjectManagerPage` 2026-10-05, which had grown to 591 lines
// holding store bindings, workspace scoping, three batched caches, bulk
// selection, six handlers and a ten-column table in one function. The page is
// now a shell; this hook owns everything the table reads.
import { useEffect, useMemo } from 'react';

import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';

import { scopeProjects, useWorkspaces } from '../sub_workspaces/workspaceStore';
import { toProject, type Project } from './projectManagerTypes';
import { useProjectTeamRosters } from './useProjectTeamRosters';
import { useProjectPulse } from './useProjectPulse';

export function useProjectManagerData() {
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const storeProjects = useSystemStore((s) => s.projects);
  // In-flight, nothing more (docs/design/overview-loading.md v2): gates ghost
  // rows ONLY into an empty region. Projects already in the store (warm return
  // visit) paint on the first frame regardless of this flag.
  const projectsLoading = useSystemStore((s) => s.projectsLoading);
  const storeActiveProjectId = useSystemStore((s) => s.activeProjectId);

  useEffect(() => { fetchProjects?.(); }, [fetchProjects]);

  // Goals are managed in the dedicated Goals module (sub_goals), so the project
  // list no longer tracks goal counts here.
  const allProjects = useMemo<Project[]>(() => storeProjects.map((p) => toProject(p, 0)), [storeProjects]);

  // The workspace layer. The table, its counts and - critically - its bulk
  // selection all work off the SCOPED list: select-all + bulk-archive reaching
  // projects from another workspace would be data loss.
  const { workspaces, activeId: activeWorkspaceId } = useWorkspaces();
  const projects = useMemo(
    () => scopeProjects(allProjects, workspaces, activeWorkspaceId),
    [allProjects, workspaces, activeWorkspaceId],
  );

  // Each dev project owns exactly ONE team, so the Members column IS the team:
  // `fetchTeams()` fills BOTH `teams` and `teamCounts` in one pass, which is
  // where the member NUMBER comes from - no per-row IPC for it.
  const fetchTeamsForBadge = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { void fetchTeamsForBadge(); }, [fetchTeamsForBadge]);
  const teamCounts = usePipelineStore((s) => s.teamCounts);

  // ...and the persona ICONS come from one shared, batched roster cache keyed by
  // teamId. Distinct ids only, memoised so the batch pass fires on a real change
  // of the set and not on every render.
  const visibleTeamIds = useMemo(
    () => [...new Set(projects.map((p) => p.teamId).filter((id): id is string => !!id))].sort(),
    [projects],
  );
  const rosters = useProjectTeamRosters(visibleTeamIds);
  const personaIndex = usePersonaIndex();

  // Attention + pulse for the scoped rows - one batched pass, module-cached. A
  // project with no measurement renders an em dash, never a 0: "nobody has
  // looked" and "looked, found nothing" are opposite facts.
  const visibleProjectIds = useMemo(() => [...new Set(projects.map((p) => p.id))].sort(), [projects]);
  const pulses = useProjectPulse(visibleProjectIds);

  return {
    storeProjects, projects, projectsLoading, storeActiveProjectId,
    workspaces, activeWorkspaceId,
    rosters, personaIndex, teamCounts, pulses,
  };
}

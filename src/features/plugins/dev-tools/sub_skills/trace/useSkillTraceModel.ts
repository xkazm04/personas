// Level-1 data spine — leaner sibling of useSkillsRegistry (no coverage, no
// session polling: Trace observes activity + versions, it doesn't adopt or
// dispatch). Fetch: library + usage overview + per-project installed lists,
// folded through the pure builder in traceModel.ts.
import { useEffect, useMemo, useState } from 'react';

import {
  getSkillUsageOverview, listSkills, listSkillsGlobal, type SkillEntry,
} from '@/api/devTools/devTools';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { presetVisual } from '../../constants/presetSkills';
import { useWorkspaces, workspaceOf } from '../../sub_workspaces/workspaceStore';
import { buildTraceMatrix, traceKey } from './traceModel';
import type { TraceCell, TraceModel, TraceProject, TraceSkillRow } from './traceTypes';

interface Fetched {
  loading: boolean;
  libraryVersionByName: Map<string, string | null>;
  installedByProject: Map<string, Map<string, { version: string | null; syncState: string }>>;
  usageByKey: Map<string, { invokes30d: number; lastInvokedAt: number | null }>;
  /** All names installed anywhere or used recently — the skill axis. */
  names: string[];
}

const EMPTY: Fetched = {
  loading: true,
  libraryVersionByName: new Map(),
  installedByProject: new Map(),
  usageByKey: new Map(),
  names: [],
};

// Module-scoped warm cache (docs/design/overview-loading.md law 1) — the page
// unmounts on every tab switch; a return visit paints on frame 1.
let cachedWorkspaceId: string | null = null;
let cachedFetched: Fetched | null = null;

const EMPTY_CELL: TraceCell = {
  adopted: false, invokes30d: 0, lastInvokedAt: null, heat: 0, tier: 'absent',
  installedVersion: null, syncState: null,
};

export function useSkillTraceModel(activeProjectId: string | null, refreshTick = 0): TraceModel {
  const { workspaces } = useWorkspaces();
  const allProjects = useSystemStore((s) => s.projects);

  const workspace = useMemo(
    () => (activeProjectId ? workspaceOf(workspaces, activeProjectId) : null) ?? workspaces[0] ?? null,
    [workspaces, activeProjectId],
  );
  const wsProjects: TraceProject[] = useMemo(
    () => (workspace?.projectIds ?? [])
      .map((id) => allProjects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, name: p.name, rootPath: p.root_path })),
    [workspace, allProjects],
  );

  const warm = workspace?.id != null && workspace.id === cachedWorkspaceId && cachedFetched != null;
  const [f, setF] = useState<Fetched>(warm ? (cachedFetched as Fetched) : EMPTY);

  useEffect(() => {
    let alive = true;
    setF((prev) => (prev.names.length > 0 ? prev : { ...prev, loading: true }));
    void (async () => {
      const [globalSkills, usageRows] = await Promise.all([
        listSkillsGlobal().catch((e) => { silentCatch('trace global')(e); return [] as SkillEntry[]; }),
        getSkillUsageOverview().catch((e) => { silentCatch('trace usage')(e); return []; }),
      ]);
      const per = await mapWithConcurrency(wsProjects, 6, async (p) => ({
        pid: p.id,
        installed: await listSkills(p.id).catch((e) => { silentCatch('trace listSkills')(e); return [] as SkillEntry[]; }),
      }));
      if (!alive) return;

      const libraryVersionByName = new Map(globalSkills.map((s) => [s.name, s.version]));
      const installedByProject = new Map<string, Map<string, { version: string | null; syncState: string }>>();
      for (const r of per) {
        installedByProject.set(r.pid, new Map(r.installed.map((s) => [s.name, { version: s.version, syncState: s.syncState }])));
      }

      const wsIds = new Set(wsProjects.map((p) => p.id));
      const usageByKey = new Map<string, { invokes30d: number; lastInvokedAt: number | null }>();
      const usedNames = new Set<string>();
      for (const u of usageRows) {
        if (u.scope !== 'project' || !u.project_id || !wsIds.has(u.project_id)) continue;
        usageByKey.set(traceKey(u.project_id, u.name), {
          invokes30d: u.invokes_30d,
          lastInvokedAt: u.last_invoked_at ? Date.parse(u.last_invoked_at.replace(' ', 'T') + 'Z') || Date.parse(u.last_invoked_at) : null,
        });
        if (u.invokes_30d > 0) usedNames.add(u.name);
      }

      // Skill axis: installed anywhere in the workspace ∪ recently used —
      // Trace is about activity, not the full unadopted catalogue.
      const names = [...new Set([
        ...[...installedByProject.values()].flatMap((m) => [...m.keys()]),
        ...usedNames,
      ])];

      const next: Fetched = { loading: false, libraryVersionByName, installedByProject, usageByKey, names };
      cachedWorkspaceId = workspace?.id ?? null;
      cachedFetched = next;
      setF(next);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, wsProjects.length, refreshTick]);

  const matrix = useMemo(
    () => buildTraceMatrix(f.names, {
      projects: wsProjects,
      installedByProject: f.installedByProject,
      usageByKey: f.usageByKey,
      now: Date.now(),
    }),
    [f, wsProjects],
  );

  const skills: TraceSkillRow[] = useMemo(
    () => f.names
      .map((name): TraceSkillRow => {
        const visual = presetVisual(name);
        const roll = matrix.rollup.get(name) ?? { totalHeat: 0, adoptedCount: 0, totalInvokes: 0 };
        return {
          name,
          visual: visual ? { icon: visual.icon, color: visual.color, label: visual.label } : null,
          libraryVersion: f.libraryVersionByName.get(name) ?? null,
          ...roll,
        };
      })
      .sort((a, b) => b.totalHeat - a.totalHeat || b.totalInvokes - a.totalInvokes || a.name.localeCompare(b.name)),
    [f, matrix],
  );

  const projectIndex = useMemo(() => new Map(wsProjects.map((p, i) => [p.id, i])), [wsProjects]);
  const cell = useMemo(() => (skillName: string, projectId: string): TraceCell => {
    const i = projectIndex.get(projectId);
    return (i != null ? matrix.cells.get(skillName)?.[i] : undefined) ?? EMPTY_CELL;
  }, [matrix, projectIndex]);

  return {
    header: workspace ? { id: workspace.id, name: workspace.name, color: workspace.color ?? null } : null,
    projects: wsProjects,
    skills,
    cell,
    loading: f.loading,
  };
}

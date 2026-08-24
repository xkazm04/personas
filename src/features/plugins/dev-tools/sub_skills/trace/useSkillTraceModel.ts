// Level-1 data spine — leaner sibling of useSkillsRegistry (no coverage
// polling: Trace observes activity + versions, it doesn't adopt or dispatch).
// Usage merges TWO sources so the tab has data before any transcript scan:
// the DB overview (skill_usage_overview — durable, transcript-mined) and the
// Fleet session log (the Analytics tab's source: sessions whose first arg
// parses as `/skill …`, mapped to workspace projects by cwd). A bounded
// transcript scan is kicked opportunistically on mount so the durable source
// backfills itself (same posture as skillsManagerData's outbox sweep).
import { useEffect, useMemo, useState } from 'react';

import {
  getSkillUsageOverview, listSkills, listSkillsGlobal, scanSkillUsage, type SkillEntry,
} from '@/api/devTools/devTools';
import { listSessions } from '@/api/fleet/fleet';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { PRESET_SKILLS, presetVisual } from '../../constants/presetSkills';
import { useWorkspaces, workspaceOf } from '../../sub_workspaces/workspaceStore';
import { parseSkillArg } from '../analytics/useSkillsAnalytics';
import { buildTraceMatrix, mergeFleetRuns, traceKey, type FleetSkillRun } from './traceModel';
import type { TraceCell, TraceModel, TraceProject, TraceSkillRow } from './traceTypes';

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

interface Fetched {
  loading: boolean;
  libraryVersionByName: Map<string, string | null>;
  trackedByName: Map<string, boolean>;
  installedByProject: Map<string, Map<string, { version: string | null; syncState: string }>>;
  usageByKey: Map<string, { invokes30d: number; lastInvokedAt: number | null }>;
  /** All names installed anywhere or used recently — the skill axis. */
  names: string[];
}

const EMPTY: Fetched = {
  loading: true,
  libraryVersionByName: new Map(),
  trackedByName: new Map(),
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
  const { workspaces, activeId } = useWorkspaces();
  const allProjects = useSystemStore((s) => s.projects);

  // Resolution order: the active project's workspace (page-consistent) → the
  // user's SELECTED workspace (store activeId) → first. The middle rung is
  // load-bearing: an active project with no workspace_id used to strand the
  // tab on workspaces[0], which can be an empty workspace while the selected
  // one is full ("0 projects, 0 skills" with a populated switcher).
  const workspace = useMemo(() => {
    const byProject = activeProjectId ? workspaceOf(workspaces, activeProjectId) : null;
    if (byProject) return byProject;
    const selected = activeId ? workspaces.find((w) => w.id === activeId) : undefined;
    return selected ?? workspaces[0] ?? null;
  }, [workspaces, activeId, activeProjectId]);

  // One bounded transcript-mining pass per mount — backfills the durable
  // usage source (manual terminal runs included); the effect below re-runs
  // when it lands. DEFERRED to idle (~1.5s after mount): the scan writes to
  // the DB and must not contend with the cold-load read burst — the Fleet
  // session source already gives the matrix its heat for the first paint.
  const [scanTick, setScanTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      scanSkillUsage()
        .catch(silentCatch('trace usage scan'))
        .finally(() => { if (alive) setScanTick((t) => t + 1); });
    }, 1500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);
  const wsProjects: TraceProject[] = useMemo(() => {
    const members = (workspace?.projectIds ?? [])
      .map((id) => allProjects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    // Membership fallback: `dev_projects.workspace_id` is an optional
    // assignment many real DBs never write (this operator's has one workspace
    // and zero assignments). A workspace with no members must not render a
    // dead tab over a repo-ful app — degrade to every active project, which
    // is what the workspace means to a single-workspace operator.
    const source = members.length > 0 ? members : allProjects.filter((p) => p.status === 'active');
    return source.map((p) => ({ id: p.id, name: p.name, rootPath: p.root_path }));
  }, [workspace, allProjects]);

  const warm = workspace?.id != null && workspace.id === cachedWorkspaceId && cachedFetched != null;
  const [f, setF] = useState<Fetched>(warm ? (cachedFetched as Fetched) : EMPTY);

  useEffect(() => {
    let alive = true;
    setF((prev) => (prev.names.length > 0 ? prev : { ...prev, loading: true }));
    void (async () => {
      const [globalSkills, usageRows, snap] = await Promise.all([
        listSkillsGlobal().catch((e) => { silentCatch('trace global')(e); return [] as SkillEntry[]; }),
        getSkillUsageOverview().catch((e) => { silentCatch('trace usage')(e); return []; }),
        listSessions().catch((e) => { silentCatch('trace sessions')(e); return { sessions: [] as never[] }; }),
      ]);
      const per = await mapWithConcurrency(wsProjects, 6, async (p) => ({
        pid: p.id,
        installed: await listSkills(p.id).catch((e) => { silentCatch('trace listSkills')(e); return [] as SkillEntry[]; }),
      }));
      if (!alive) return;

      const libraryVersionByName = new Map(globalSkills.map((s) => [s.name, s.version]));
      const trackedByName = new Map(globalSkills.map((s) => [s.name, s.contextTracked]));
      const installedByProject = new Map<string, Map<string, { version: string | null; syncState: string }>>();
      for (const r of per) {
        installedByProject.set(r.pid, new Map(r.installed.map((s) => [s.name, { version: s.version, syncState: s.syncState }])));
      }

      const wsIds = new Set(wsProjects.map((p) => p.id));
      const dbUsage = new Map<string, { invokes30d: number; lastInvokedAt: number | null }>();
      for (const u of usageRows) {
        if (u.scope !== 'project' || !u.project_id || !wsIds.has(u.project_id)) continue;
        dbUsage.set(traceKey(u.project_id, u.name), {
          invokes30d: u.invokes_30d,
          lastInvokedAt: u.last_invoked_at ? Date.parse(u.last_invoked_at.replace(' ', 'T') + 'Z') || Date.parse(u.last_invoked_at) : null,
        });
      }

      // Fleet session log — the Analytics tab's run source, mapped to
      // workspace projects by cwd. Covers the window before/between scans.
      const projectIdByRoot = new Map(wsProjects.map((p) => [normPath(p.rootPath), p.id]));
      const fleetRuns: FleetSkillRun[] = [];
      for (const sess of (snap as { sessions: Array<{ args: string[]; cwd: string; createdAtMs: string | number; lastActivityMs: string | number }> }).sessions) {
        const parsed = parseSkillArg(sess.args);
        const pid = projectIdByRoot.get(normPath(sess.cwd));
        if (!parsed || !pid) continue;
        fleetRuns.push({
          skill: parsed.skill,
          projectId: pid,
          startedAt: Number(sess.createdAtMs),
          lastActivityAt: Number(sess.lastActivityMs) || Number(sess.createdAtMs),
        });
      }
      const { merged: usageByKey } = mergeFleetRuns(dbUsage, fleetRuns, Date.now());

      // Skill axis: WORKSPACE-LEVEL skills only — the library
      // (~/.claude/skills) plus the app-owned presets (same catalogue rule
      // as the Registry tab). NOT the union of every project-local skill: a
      // repo-private skill is not workspace doctrine, and a row here implies
      // "this method is shared". Project-local activity on non-library
      // skills is deliberately invisible until the skill is shared up.
      const names = [...new Set([
        ...globalSkills.map((s) => s.name),
        ...PRESET_SKILLS.keys(),
      ])];

      const next: Fetched = { loading: false, libraryVersionByName, trackedByName, installedByProject, usageByKey, names };
      cachedWorkspaceId = workspace?.id ?? null;
      cachedFetched = next;
      setF(next);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, wsProjects.length, refreshTick, scanTick]);

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
          // Preset-only rows (not materialized in the library) are all
          // group-1 context-aware skills, so default true for them.
          contextTracked: f.trackedByName.get(name) ?? true,
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

  const header = useMemo(
    () => (workspace ? { id: workspace.id, name: workspace.name, color: workspace.color ?? null } : null),
    [workspace],
  );

  // Stable model identity: consumers memo derived aggregates (column totals,
  // tree scenes) on the model object, so it must only change when data does —
  // a fresh literal per render silently defeated every one of those memos.
  return useMemo(
    () => ({ header, projects: wsProjects, skills, cell, loading: f.loading }),
    [header, wsProjects, skills, cell, f.loading],
  );
}

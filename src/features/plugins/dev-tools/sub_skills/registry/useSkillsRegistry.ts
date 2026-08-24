// Skills Registry data spine — assembles the workspace-wide coverage matrix.
//
// Rows = the library skill catalogue ∪ the app's preset scan lenses ∪ everything
// already installed somewhere in the matrix. Columns = the projects in the active
// project's workspace. Per (skill, project) cell: adopted? + Memory-Ledger
// coverage + 30d invokes + whether a Fleet session is currently dispatching it
// there (the block-adopt signal). All reads are per-project fan-out, bounded by
// mapWithConcurrency.
//
// ## Which library the rows come from
//
// The same one the Overview tab reads: the wired knowledge registry's `skills/`
// lane when this workspace holds a registry, and `~/.claude/skills` otherwise.
// It used to be `~/.claude/skills` unconditionally, so on a registry-wired
// workspace the two tabs of ONE page listed two different libraries and neither
// said so. The workspace was already resolved here — the join was simply never
// made.
//
// ## Why installed-anywhere is unioned in
//
// Heading the library at a registry SUBTRACTS rows: a skill that lives only in
// `~/.claude/skills` disappears from the catalogue the moment a registry is
// wired. For a shelf of things you might adopt that is correct. For a COVERAGE
// matrix it is not — a skill already installed in three projects, with real
// coverage and real invokes, would vanish from the only surface that shows
// where it is. A matrix cannot report coverage of a row it excludes, so
// anything present in any column earns its row regardless of library source.
import { useEffect, useMemo, useState } from 'react';

import {
  getSkillUsageOverview, listSkills, listSkillsGlobal, memoryCoverage, memorySkillCoverage,
  type SkillCoverageRow, type SkillEntry,
} from '@/api/devTools/devTools';
import { listSessions } from '@/api/fleet/fleet';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { PRESET_SKILLS, presetVisual } from '../../constants/presetSkills';
import { useRegistryLibrary } from '../../sub_workspaces/registry/useRegistryLibrary';
import { useWorkspaces, workspaceOf } from '../../sub_workspaces/workspaceStore';
import { parseSkillArg } from '../analytics/useSkillsAnalytics';
import { cellKey, type RegistryCell, type RegistryColumn, type RegistryModel, type RegistrySkill } from './registryTypes';

const LIVE_STATES = new Set(['spawning', 'running', 'awaiting_input']);
/** Cadence of the decoupled run-lock poll (one cheap listSessions IPC). */
const SESSIONS_POLL_MS = 10_000;
const GROUP_LABEL: Record<string, string> = {
  technical: 'Technical', user: 'User experience', business: 'Business', mastermind: 'Mastermind',
};

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/** Identity-preserving set compare so an unchanged poll never re-renders. */
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

interface Fetched {
  loading: boolean;
  libraryNames: string[];
  customCategory: Map<string, string>;
  /** Skill description, for the adopt confirmation modal. */
  descByName: Map<string, string>;
  installedByProject: Map<string, Set<string>>;
  covByKey: Map<string, SkillCoverageRow>;
  ctxByProject: Map<string, number>;
  usageByKey: Map<string, number>;
}

const EMPTY: Fetched = {
  loading: true, libraryNames: [], customCategory: new Map(), descByName: new Map(), installedByProject: new Map(),
  covByKey: new Map(), ctxByProject: new Map(), usageByKey: new Map(),
};

export function useSkillsRegistry(activeProjectId: string | null, refreshTick = 0): RegistryModel {
  const { workspaces } = useWorkspaces();
  const allProjects = useSystemStore((s) => s.projects);
  const [f, setF] = useState<Fetched>(EMPTY);

  // The workspace under inspection — the active project's, else the first one.
  const workspace = useMemo(
    () => (activeProjectId ? workspaceOf(workspaces, activeProjectId) : null) ?? workspaces[0] ?? null,
    [workspaces, activeProjectId],
  );

  const wsProjects = useMemo(() => {
    const members = (workspace?.projectIds ?? [])
      .map((id) => allProjects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    // Membership fallback (mirrors useSkillTraceModel): workspace_id is an
    // optional assignment many DBs never write; an empty workspace over a
    // repo-ful app degrades to every active project instead of a dead matrix.
    return members.length > 0 ? members : allProjects.filter((p) => p.status === 'active');
  }, [workspace, allProjects]);

  const projectRootById = useMemo(
    () => new Map(wsProjects.map((p) => [normPath(p.root_path), p.id])),
    [wsProjects],
  );

  // Which library the rows come from. `useRegistryLibrary` is keyed by PROJECT
  // and re-derives the workspace itself, so it is handed a project of the
  // workspace resolved above rather than `activeProjectId` — with no active
  // project the matrix still falls back to the first workspace, and the rows
  // have to follow the columns into it.
  const libraryProjectId = activeProjectId ?? workspace?.projectIds[0] ?? null;
  const { libraryRoot } = useRegistryLibrary(libraryProjectId);

  useEffect(() => {
    let alive = true;
    setF((prev) => ({ ...prev, loading: true }));
    void (async () => {
      // -- PHASE 1: the matrix's shape — library rows + adopted state. Two
      // cheap fetch groups, published immediately so the grid paints with
      // adopt/dispatch affordances while telemetry is still in flight.
      const globalSkills = await listSkillsGlobal(libraryRoot).catch((e) => { silentCatch('registry global')(e); return [] as SkillEntry[]; });
      const perInstalled = await mapWithConcurrency(wsProjects, 6, async (p) => ({
        pid: p.id,
        installed: await listSkills(p.id).catch((e) => { silentCatch('registry listSkills')(e); return [] as SkillEntry[]; }),
      }));
      if (!alive) return;

      const installedByProject = new Map<string, Set<string>>();
      const customCategory = new Map<string, string>();
      const descByName = new Map<string, string>();
      for (const r of perInstalled) {
        installedByProject.set(r.pid, new Set(r.installed.map((s) => s.name)));
        for (const s of r.installed) {
          if (s.category) customCategory.set(s.name, s.category);
          if (s.description) descByName.set(s.name, s.description);
        }
      }
      for (const s of globalSkills) {
        if (s.category) customCategory.set(s.name, s.category);
        if (s.description) descByName.set(s.name, s.description);
      }
      // Installed-anywhere is part of the row set, not just the library — see
      // the module header. Without it, wiring a registry silently drops every
      // home-library skill out of the matrix, coverage and invokes included.
      const libraryNames = [...new Set([
        ...globalSkills.map((s) => s.name),
        ...PRESET_SKILLS.keys(),
        ...perInstalled.flatMap((r) => r.installed.map((s) => s.name)),
      ])];

      const phase1: Fetched = {
        loading: false, libraryNames, customCategory, descByName, installedByProject,
        covByKey: new Map(), ctxByProject: new Map(), usageByKey: new Map(),
      };
      setF(phase1);

      // -- PHASE 2: telemetry enrichment (coverage %, 30d invokes). Merged
      // over the painted grid when it lands. Live-run locks are NOT here —
      // they ride the decoupled sessions poll below, so a dispatch never
      // re-triggers this fan-out.
      const usageRows = await getSkillUsageOverview().catch((e) => { silentCatch('registry usage')(e); return []; });
      const perCov = await mapWithConcurrency(wsProjects, 4, async (p) => {
        const [cov, mc] = await Promise.all([
          memorySkillCoverage(p.id).catch((e) => { silentCatch('registry coverage')(e); return [] as SkillCoverageRow[]; }),
          memoryCoverage(p.id).catch((e) => { silentCatch('registry contexts')(e); return { contexts: 0 } as { contexts: number }; }),
        ]);
        return { pid: p.id, cov, contexts: mc.contexts };
      });
      if (!alive) return;

      const covByKey = new Map<string, SkillCoverageRow>();
      const ctxByProject = new Map<string, number>();
      for (const r of perCov) {
        for (const c of r.cov) covByKey.set(cellKey(r.pid, c.skill), c);
        ctxByProject.set(r.pid, r.contexts);
      }

      const usageByKey = new Map<string, number>();
      for (const u of usageRows) {
        if (u.scope === 'project' && u.project_id) usageByKey.set(cellKey(u.project_id, u.name), u.invokes_30d);
      }

      setF({ ...phase1, covByKey, ctxByProject, usageByKey });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, wsProjects.length, libraryRoot, refreshTick]);

  // Live-run locks — a lightweight sessions poll, deliberately DECOUPLED from
  // the listSkills/coverage fan-out above: a dispatch only changes which cells
  // are running, so watching sessions must never re-trigger a matrix refetch.
  // One IPC per tick, identity-preserving so an unchanged poll is render-free.
  const [running, setRunning] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const snap = await listSessions().catch((e) => { silentCatch('registry sessions')(e); return { sessions: [] as never[] }; });
      if (!alive) return;
      const next = new Set<string>();
      for (const sess of (snap as { sessions: Array<{ args: string[]; cwd: string; state: string }> }).sessions) {
        if (!LIVE_STATES.has(sess.state)) continue;
        const parsed = parseSkillArg(sess.args);
        const pid = projectRootById.get(normPath(sess.cwd));
        if (parsed && pid) next.add(cellKey(parsed.skill, pid));
      }
      setRunning((prev) => (sameSet(prev, next) ? prev : next));
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, SESSIONS_POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectRootById, refreshTick]);

  const columns: RegistryColumn[] = useMemo(
    () => wsProjects.map((p) => ({
      id: p.id,
      name: p.name,
      rootPath: p.root_path,
      units: f.ctxByProject.get(p.id) ?? 0,
      presentCount: f.installedByProject.get(p.id)?.size ?? 0,
    })),
    [wsProjects, f],
  );

  const skills: RegistrySkill[] = useMemo(() => {
    const rows = f.libraryNames.map((name): RegistrySkill => {
      const preset = PRESET_SKILLS.get(name);
      const visual = presetVisual(name);
      const categoryGroup = preset?.categoryGroup ?? f.customCategory.get(name) ?? 'Other';
      let adoptedCount = 0;
      let totalInvokes = 0;
      for (const p of wsProjects) {
        if (f.installedByProject.get(p.id)?.has(name)) adoptedCount += 1;
        totalInvokes += f.usageByKey.get(cellKey(p.id, name)) ?? 0;
      }
      return {
        name,
        visual: visual ? { icon: visual.icon, color: visual.color, label: visual.label } : null,
        category: GROUP_LABEL[categoryGroup] ?? (f.customCategory.get(name) ?? 'Other'),
        categoryGroup,
        adoptedCount,
        totalInvokes,
        description: f.descByName.get(name) ?? PRESET_SKILLS.get(name)?.description ?? null,
      };
    });
    // Group by category, then strictly name-asc within the group. (Adopted-first
    // used to win inside a group, which meant a row moved the moment you adopted
    // it — the list re-ordered under the cursor that had just clicked it.)
    return rows.sort((a, b) =>
      a.category.localeCompare(b.category)
      || a.name.localeCompare(b.name));
  }, [f, wsProjects]);

  const cell = useMemo(() => (skillName: string, projectId: string): RegistryCell => ({
    adopted: f.installedByProject.get(projectId)?.has(skillName) ?? false,
    coveredUnits: f.covByKey.get(cellKey(projectId, skillName))?.coveredContexts ?? 0,
    invokes30d: f.usageByKey.get(cellKey(projectId, skillName)) ?? 0,
    running: running.has(cellKey(skillName, projectId)),
  }), [f, running]);

  return {
    mode: 'workspace',
    header: workspace ? { id: workspace.id, name: workspace.name, color: workspace.color } : null,
    columns,
    skills,
    cell,
    loading: f.loading,
  };
}

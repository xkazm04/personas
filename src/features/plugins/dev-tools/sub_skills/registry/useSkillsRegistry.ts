// Skills Registry data spine — assembles the workspace-wide coverage matrix.
//
// Rows = the library skill catalogue (global `~/.claude/skills` ∪ the app's
// preset scan lenses). Columns = the projects in the active project's workspace.
// Per (skill, project) cell: adopted? + Memory-Ledger coverage + 30d invokes +
// whether a Fleet session is currently dispatching it there (the block-adopt
// signal). All reads are per-project fan-out, bounded by mapWithConcurrency.
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
import { useWorkspaces, workspaceOf } from '../../sub_workspaces/workspaceStore';
import { parseSkillArg } from '../analytics/useSkillsAnalytics';
import { cellKey, type RegistryCell, type RegistryColumn, type RegistryModel, type RegistrySkill } from './registryTypes';

const LIVE_STATES = new Set(['spawning', 'running', 'awaiting_input']);
const GROUP_LABEL: Record<string, string> = {
  technical: 'Technical', user: 'User experience', business: 'Business', mastermind: 'Mastermind',
};

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
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
  runningSet: Set<string>;
}

const EMPTY: Fetched = {
  loading: true, libraryNames: [], customCategory: new Map(), descByName: new Map(), installedByProject: new Map(),
  covByKey: new Map(), ctxByProject: new Map(), usageByKey: new Map(), runningSet: new Set(),
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

  const wsProjects = useMemo(
    () => (workspace?.projectIds ?? [])
      .map((id) => allProjects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p)),
    [workspace, allProjects],
  );

  const projectRootById = useMemo(
    () => new Map(wsProjects.map((p) => [normPath(p.root_path), p.id])),
    [wsProjects],
  );

  useEffect(() => {
    let alive = true;
    setF((prev) => ({ ...prev, loading: true }));
    void (async () => {
      const [globalSkills, usageRows, snap] = await Promise.all([
        listSkillsGlobal().catch((e) => { silentCatch('registry global')(e); return [] as SkillEntry[]; }),
        getSkillUsageOverview().catch((e) => { silentCatch('registry usage')(e); return []; }),
        listSessions().catch((e) => { silentCatch('registry sessions')(e); return { sessions: [] as never[] }; }),
      ]);

      const per = await mapWithConcurrency(wsProjects, 6, async (p) => {
        const [installed, cov, mc] = await Promise.all([
          listSkills(p.id).catch((e) => { silentCatch('registry listSkills')(e); return [] as SkillEntry[]; }),
          memorySkillCoverage(p.id).catch((e) => { silentCatch('registry coverage')(e); return [] as SkillCoverageRow[]; }),
          memoryCoverage(p.id).catch((e) => { silentCatch('registry contexts')(e); return { contexts: 0 } as { contexts: number }; }),
        ]);
        return { pid: p.id, installed, cov, contexts: mc.contexts };
      });
      if (!alive) return;

      const installedByProject = new Map<string, Set<string>>();
      const covByKey = new Map<string, SkillCoverageRow>();
      const ctxByProject = new Map<string, number>();
      const customCategory = new Map<string, string>();
      const descByName = new Map<string, string>();
      for (const r of per) {
        installedByProject.set(r.pid, new Set(r.installed.map((s) => s.name)));
        for (const s of r.installed) {
          if (s.category) customCategory.set(s.name, s.category);
          if (s.description) descByName.set(s.name, s.description);
        }
        for (const c of r.cov) covByKey.set(cellKey(r.pid, c.skill), c);
        ctxByProject.set(r.pid, r.contexts);
      }
      for (const s of globalSkills) {
        if (s.category) customCategory.set(s.name, s.category);
        if (s.description) descByName.set(s.name, s.description);
      }

      const usageByKey = new Map<string, number>();
      for (const u of usageRows) {
        if (u.scope === 'project' && u.project_id) usageByKey.set(cellKey(u.project_id, u.name), u.invokes_30d);
      }

      const runningSet = new Set<string>();
      for (const sess of (snap as { sessions: Array<{ args: string[]; cwd: string; state: string }> }).sessions) {
        if (!LIVE_STATES.has(sess.state)) continue;
        const parsed = parseSkillArg(sess.args);
        const pid = projectRootById.get(normPath(sess.cwd));
        if (parsed && pid) runningSet.add(cellKey(parsed.skill, pid));
      }

      const libraryNames = [...new Set([
        ...globalSkills.map((s) => s.name),
        ...PRESET_SKILLS.keys(),
      ])];

      setF({ loading: false, libraryNames, customCategory, descByName, installedByProject, covByKey, ctxByProject, usageByKey, runningSet });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, wsProjects.length, refreshTick]);

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
    running: f.runningSet.has(cellKey(skillName, projectId)),
  }), [f]);

  return {
    mode: 'workspace',
    header: workspace ? { id: workspace.id, name: workspace.name, color: workspace.color } : null,
    columns,
    skills,
    cell,
    loading: f.loading,
  };
}

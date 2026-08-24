// Project-scoped registry spine — the SAME matrix as `useSkillsRegistry`, with
// the column axis turned inward.
//
// Rows = the skills installed in this project. Columns = the project's CONTEXT
// GROUPS. Per cell: how many of the group's contexts this skill has actually
// touched (Memory-Ledger attribution), aggregated to a completion %, plus 30d
// invokes and whether a Fleet session is dispatching the skill here right now.
//
// The question it answers is different from the workspace matrix's. There:
// "which repos have this skill?" Here: "which PARTS of this repo has this skill
// been through — and where has it never run?" Nothing is adopted per context,
// so every cell is a dispatch.
//
// Cost note: per-context attribution is only available per skill
// (`memorySkillContexts`), so this is one IPC per installed skill. Bounded at 6
// concurrent, and the row set is the project's installed skills (small), not the
// whole library.
import { useEffect, useMemo, useState } from 'react';

import {
  getSkillUsageOverview, listContextGroups, listContexts, listSkills, memorySkillContexts,
  type DevContextGroup, type SkillEntry,
} from '@/api/devTools/devTools';
import { listSessions } from '@/api/fleet/fleet';
import type { DevContext } from '@/lib/bindings/DevContext';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { PRESET_SKILLS, presetVisual } from '../../constants/presetSkills';
import { parseSkillArg } from '../analytics/useSkillsAnalytics';
import { cellKey, type RegistryCell, type RegistryColumn, type RegistryModel, type RegistrySkill } from './registryTypes';

const LIVE_STATES = new Set(['spawning', 'running', 'awaiting_input']);
/** Cadence of the decoupled run-lock poll (one cheap listSessions IPC). */
const SESSIONS_POLL_MS = 10_000;
const GROUP_LABEL: Record<string, string> = {
  technical: 'Technical', user: 'User experience', business: 'Business', mastermind: 'Mastermind',
};
/** Contexts with no group still have to live somewhere. */
const UNGROUPED = '__ungrouped';

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
  installed: SkillEntry[];
  groups: DevContextGroup[];
  contexts: DevContext[];
  /** `${skill}|${groupId}` → contexts of that group the skill has touched. */
  coveredByKey: Map<string, number>;
  usageBySkill: Map<string, number>;
}

const EMPTY: Fetched = {
  loading: true, installed: [], groups: [], contexts: [],
  coveredByKey: new Map(), usageBySkill: new Map(),
};

export function useProjectRegistry(projectId: string | null, refreshTick = 0): RegistryModel {
  const projects = useSystemStore((s) => s.projects);
  const [f, setF] = useState<Fetched>(EMPTY);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  useEffect(() => {
    if (!projectId) { setF({ ...EMPTY, loading: false }); return; }
    let alive = true;
    setF((prev) => ({ ...prev, loading: true }));
    void (async () => {
      const [installed, groups, contexts, usageRows] = await Promise.all([
        listSkills(projectId).catch((e) => { silentCatch('projectRegistry listSkills')(e); return [] as SkillEntry[]; }),
        listContextGroups(projectId),
        listContexts(projectId).catch((e) => { silentCatch('projectRegistry listContexts')(e); return [] as DevContext[]; }),
        getSkillUsageOverview().catch((e) => { silentCatch('projectRegistry usage')(e); return []; }),
      ]);
      if (!alive) return;

      const groupOfContext = new Map(contexts.map((c) => [c.id, c.group_id ?? UNGROUPED]));

      // Per-context attribution is only queryable one skill at a time.
      const per = await mapWithConcurrency(installed, 6, async (s) => ({
        skill: s.name,
        rows: await memorySkillContexts(projectId, s.name)
          .catch((e) => { silentCatch('projectRegistry skillContexts')(e); return []; }),
      }));
      if (!alive) return;

      const coveredByKey = new Map<string, number>();
      for (const { skill, rows } of per) {
        for (const row of rows) {
          // freshNodes === 0 means the context is listed but untouched — that is
          // the honest zero the matrix must show, not a covered cell.
          if (row.freshNodes <= 0) continue;
          const g = groupOfContext.get(row.contextId) ?? UNGROUPED;
          const k = cellKey(skill, g);
          coveredByKey.set(k, (coveredByKey.get(k) ?? 0) + 1);
        }
      }

      const usageBySkill = new Map<string, number>();
      for (const u of usageRows) {
        if (u.scope === 'project' && u.project_id === projectId) usageBySkill.set(u.name, u.invokes_30d);
      }

      setF({ loading: false, installed, groups, contexts, coveredByKey, usageBySkill });
    })();
    return () => { alive = false; };
  }, [projectId, project?.root_path, refreshTick]);

  // Live-run locks — a lightweight sessions poll, deliberately DECOUPLED from
  // the per-skill attribution fan-out above: a dispatch only changes which
  // cells are running, so watching sessions must never re-trigger the fan-out.
  const [running, setRunning] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!projectId) { setRunning((prev) => (prev.size === 0 ? prev : new Set())); return; }
    let alive = true;
    const root = normPath(project?.root_path ?? '');
    const read = async () => {
      const snap = await listSessions().catch((e) => { silentCatch('projectRegistry sessions')(e); return { sessions: [] as never[] }; });
      if (!alive) return;
      const next = new Set<string>();
      for (const sess of (snap as { sessions: Array<{ args: string[]; cwd: string; state: string }> }).sessions) {
        if (!LIVE_STATES.has(sess.state)) continue;
        if (root && normPath(sess.cwd) !== root) continue;
        const parsed = parseSkillArg(sess.args);
        if (parsed) next.add(parsed.skill);
      }
      setRunning((prev) => (sameSet(prev, next) ? prev : next));
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, SESSIONS_POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectId, project?.root_path, refreshTick]);

  /** Context groups that actually hold contexts, plus an ungrouped bucket when
   *  one is needed. A group with no contexts has a zero denominator and would
   *  render as a permanently dead column. */
  const columns: RegistryColumn[] = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const c of f.contexts) {
      const g = c.group_id ?? UNGROUPED;
      sizes.set(g, (sizes.get(g) ?? 0) + 1);
    }
    const rootPath = project?.root_path ?? '';
    const cols: RegistryColumn[] = [];
    for (const g of f.groups) {
      const units = sizes.get(g.id) ?? 0;
      if (units === 0) continue;
      cols.push({
        id: g.id,
        name: g.name,
        rootPath,
        units,
        presentCount: f.installed.filter((s) => (f.coveredByKey.get(cellKey(s.name, g.id)) ?? 0) > 0).length,
        color: g.color,
      });
    }
    const loose = sizes.get(UNGROUPED) ?? 0;
    if (loose > 0) {
      cols.push({
        id: UNGROUPED,
        name: 'Ungrouped',
        rootPath,
        units: loose,
        presentCount: f.installed.filter((s) => (f.coveredByKey.get(cellKey(s.name, UNGROUPED)) ?? 0) > 0).length,
        color: null,
      });
    }
    return cols;
  }, [f, project?.root_path]);

  const skills: RegistrySkill[] = useMemo(() => {
    const rows = f.installed.map((s): RegistrySkill => {
      const preset = PRESET_SKILLS.get(s.name);
      const visual = presetVisual(s.name);
      const categoryGroup = preset?.categoryGroup ?? s.category ?? 'Other';
      return {
        name: s.name,
        visual: visual ? { icon: visual.icon, color: visual.color, label: visual.label } : null,
        category: GROUP_LABEL[categoryGroup] ?? (s.category ?? 'Other'),
        categoryGroup,
        adoptedCount: columns.filter((c) => (f.coveredByKey.get(cellKey(s.name, c.id)) ?? 0) > 0).length,
        totalInvokes: f.usageBySkill.get(s.name) ?? 0,
        description: s.description,
      };
    });
    // Category, then strictly name-asc within it — same ordering rule as the
    // workspace matrix, so a row never moves under the cursor.
    return rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [f, columns]);

  const cell = useMemo(() => (skillName: string, columnId: string): RegistryCell => {
    const covered = f.coveredByKey.get(cellKey(skillName, columnId)) ?? 0;
    return {
      adopted: covered > 0,
      coveredUnits: covered,
      invokes30d: f.usageBySkill.get(skillName) ?? 0,
      running: running.has(skillName),
    };
  }, [f, running]);

  return {
    mode: 'project',
    header: project ? { id: project.id, name: project.name, color: 'var(--primary)' } : null,
    columns,
    skills,
    cell,
    loading: f.loading,
  };
}

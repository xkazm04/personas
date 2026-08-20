// Pure Trace math — no React, no fetches, fully unit-tested. The hooks fetch;
// this file decides what the numbers mean, so the legend, the tests and the
// render all agree on one definition of "hot".
import type { SkillLessonRow, SkillRevisionRow } from '@/api/devTools/devTools';

import type {
  DriftState, HeatTier, SkillTreeModel, TraceCell, TraceProject, TreeBranch,
} from './traceTypes';

/** Recency half-life: a cell's heat halves every 7 days of silence. */
export const HEAT_HALF_LIFE_DAYS = 7;

const DAY_MS = 86_400_000;

/** Raw (un-normalized) heat: volume dampened by sqrt so one chatty skill
 *  can't blow out the scale, decayed by recency half-life. 0 when never
 *  invoked in the window. `now` is a parameter — determinism for tests. */
export function rawHeat(invokes30d: number, lastInvokedAt: number | null, now: number): number {
  if (invokes30d <= 0 || lastInvokedAt == null) return 0;
  const ageDays = Math.max(0, (now - lastInvokedAt) / DAY_MS);
  return Math.sqrt(invokes30d) * Math.pow(0.5, ageDays / HEAT_HALF_LIFE_DAYS);
}

/** Tier boundaries over NORMALIZED heat. */
export function heatTier(heat: number, adopted: boolean): HeatTier {
  if (heat <= 0) return adopted ? 'cold' : 'absent';
  if (heat >= 0.55) return 'hot';
  if (heat >= 0.2) return 'warm';
  return 'cool';
}

/** Compare two "major.minor" versions; null = implicit 1.0. */
export function parseVersion(v: string | null): [number, number] {
  if (!v) return [1, 0];
  const m = v.match(/^(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [1, 0];
}

function cmpVersion(a: string | null, b: string | null): number {
  const [am, an] = parseVersion(a);
  const [bm, bn] = parseVersion(b);
  return am - bm || an - bn;
}

/** Drift verdict of an installed copy vs the library copy.
 *  Version compare carries intent; the hash-based syncState only breaks the
 *  equal-version tie (equal + diverged = locally customized). */
export function driftOf(
  installedVersion: string | null,
  libraryVersion: string | null,
  syncState: string | null,
): DriftState {
  if (installedVersion == null && libraryVersion == null) return 'unversioned';
  const c = cmpVersion(installedVersion, libraryVersion);
  if (c < 0) return 'behind';
  if (c > 0) return 'ahead';
  // Equal versions, but the hashes disagree — so WHICH side moved decides the
  // verdict. `stale` means the library changed and this copy did not, which is
  // `behind` even though the version numbers match (a library edited without a
  // bump; the skill standard forbids it, and rendering it as `customized` would
  // blame the wrong side). `diverged` means this copy was edited.
  if (syncState === 'stale') return 'behind';
  return syncState === 'diverged' ? 'customized' : 'in_sync';
}

/** One live/parked Fleet skill run, pre-mapped to a workspace project. */
export interface FleetSkillRun {
  skill: string;
  projectId: string;
  /** ms epoch. */
  startedAt: number;
  /** ms epoch of last activity (falls back to startedAt). */
  lastActivityAt: number;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

/** Fold Fleet-session skill runs into the usage map. The transcript miner
 *  (skill_usage_overview) eventually counts the SAME invocations, so per key
 *  we take max(count) and max(timestamp) rather than summing — Fleet fills
 *  the gap before/between scans (the Analytics tab's source, reused here). */
export function mergeFleetRuns(
  usageByKey: Map<string, { invokes30d: number; lastInvokedAt: number | null }>,
  runs: FleetSkillRun[],
  now: number,
): { merged: Map<string, { invokes30d: number; lastInvokedAt: number | null }>; usedNames: Set<string> } {
  const fleetByKey = new Map<string, { skill: string; count: number; last: number }>();
  for (const r of runs) {
    if (now - r.startedAt > THIRTY_DAYS_MS) continue;
    const key = traceKey(r.projectId, r.skill);
    const cur = fleetByKey.get(key) ?? { skill: r.skill, count: 0, last: 0 };
    cur.count += 1;
    cur.last = Math.max(cur.last, r.lastActivityAt || r.startedAt);
    fleetByKey.set(key, cur);
  }

  const merged = new Map(usageByKey);
  const usedNames = new Set<string>();
  for (const [key, f] of fleetByKey) {
    const db = merged.get(key);
    merged.set(key, {
      invokes30d: Math.max(db?.invokes30d ?? 0, f.count),
      lastInvokedAt: Math.max(db?.lastInvokedAt ?? 0, f.last) || null,
    });
    usedNames.add(f.skill);
  }
  return { merged, usedNames };
}

export interface MatrixInputs {
  projects: TraceProject[];
  /** Installed entries per project id: name → {version, syncState}. */
  installedByProject: Map<string, Map<string, { version: string | null; syncState: string }>>;
  /** Per `${projectId} ${skill}`: usage aggregates. */
  usageByKey: Map<string, { invokes30d: number; lastInvokedAt: number | null }>;
  now: number;
}

export const traceKey = (projectId: string, skill: string) => `${projectId} ${skill}`;

export interface BuiltMatrix {
  /** Skill name → per-project cells (same order as inputs.projects). */
  cells: Map<string, TraceCell[]>;
  /** Skill name → totalHeat/adoptedCount/totalInvokes rollup. */
  rollup: Map<string, { totalHeat: number; adoptedCount: number; totalInvokes: number }>;
}

/** Assemble the normalized matrix for every skill name given. */
export function buildTraceMatrix(skillNames: string[], inputs: MatrixInputs): BuiltMatrix {
  // Pass 1: raw heat per cell, tracking the matrix max for normalization.
  const raw = new Map<string, number[]>();
  let max = 0;
  for (const name of skillNames) {
    const heats = inputs.projects.map((p) => {
      const u = inputs.usageByKey.get(traceKey(p.id, name));
      const h = u ? rawHeat(u.invokes30d, u.lastInvokedAt, inputs.now) : 0;
      if (h > max) max = h;
      return h;
    });
    raw.set(name, heats);
  }

  const cells = new Map<string, TraceCell[]>();
  const rollup = new Map<string, { totalHeat: number; adoptedCount: number; totalInvokes: number }>();
  for (const name of skillNames) {
    const heats = raw.get(name) ?? [];
    let totalHeat = 0;
    let adoptedCount = 0;
    let totalInvokes = 0;
    const row = inputs.projects.map((p, i): TraceCell => {
      const installed = inputs.installedByProject.get(p.id)?.get(name);
      const u = inputs.usageByKey.get(traceKey(p.id, name));
      const heat = max > 0 ? (heats[i] ?? 0) / max : 0;
      const adopted = Boolean(installed);
      totalHeat += heat;
      if (adopted) adoptedCount += 1;
      totalInvokes += u?.invokes30d ?? 0;
      return {
        adopted,
        invokes30d: u?.invokes30d ?? 0,
        lastInvokedAt: u?.lastInvokedAt ?? null,
        heat,
        tier: heatTier(heat, adopted),
        installedVersion: installed?.version ?? null,
        syncState: installed?.syncState ?? null,
      };
    });
    cells.set(name, row);
    rollup.set(name, { totalHeat, adoptedCount, totalInvokes });
  }
  return { cells, rollup };
}

/** Assemble the Level-2 tree from already-built matrix cells (no refetch). */
export function buildSkillTree(
  _skillName: string,
  projects: TraceProject[],
  cellsForSkill: TraceCell[],
  libraryVersion: string | null,
  timeline: SkillRevisionRow[],
  lessons: SkillLessonRow[],
): Pick<SkillTreeModel, 'branches' | 'timeline' | 'workspaceLessons' | 'totalInvokes'> {
  const adopted = projects
    .map((p, i) => ({ project: p, cell: cellsForSkill[i] }))
    .filter((x): x is { project: TraceProject; cell: TraceCell } => Boolean(x.cell?.adopted));
  const maxInvokes = Math.max(1, ...adopted.map((x) => x.cell.invokes30d));

  const byProjectId = new Map<string, SkillLessonRow[]>();
  const workspaceLessons: SkillLessonRow[] = [];
  for (const l of lessons) {
    if (l.scope === 'global' || !l.project_id) workspaceLessons.push(l);
    else {
      const list = byProjectId.get(l.project_id) ?? [];
      list.push(l);
      byProjectId.set(l.project_id, list);
    }
  }

  const branches: TreeBranch[] = adopted
    .map(({ project, cell }): TreeBranch => ({
      project,
      weight: cell.invokes30d / maxInvokes,
      invokes30d: cell.invokes30d,
      lastInvokedAt: cell.lastInvokedAt,
      installedVersion: cell.installedVersion,
      drift: driftOf(cell.installedVersion, libraryVersion, cell.syncState),
      lessons: byProjectId.get(project.id) ?? [],
    }))
    .sort((a, b) => b.weight - a.weight || a.project.name.localeCompare(b.project.name));

  return {
    branches,
    timeline: [...timeline].sort((a, b) => b.rev - a.rev),
    workspaceLessons,
    totalInvokes: adopted.reduce((n, x) => n + x.cell.invokes30d, 0),
  };
}

// Goal Acceptance — domain model + the live adapter that maps the backend's
// flat `PendingAcceptanceGoal` rows into the grouped view-model the variant
// consumes (team → KPI → goal). (Prototyping is over; the MOCK_* fixtures were
// removed when the view went live — the filename is retained only to avoid
// churn on the importers.)
import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';

export interface PendingTeam {
  id: string;
  name: string;
  /** Accent (CSS color) — the team's monogram tint, derived from its id. */
  color: string;
  /** 2-letter monogram for the avatar. */
  monogram: string;
}

export interface PendingProject {
  id: string;
  name: string;
}

export interface PendingKpi {
  id: string;
  name: string;
  unit: string;
  direction: 'up' | 'down';
  baseline: number;
  current: number;
  target: number;
  /** Simple "not met yet" display flag (the gauge tint). */
  offTrack: boolean;
}

export interface PendingGoal {
  id: string;
  projectId: string;
  title: string;
  /** One-line of what the team shipped (the goal's outcome summary). */
  summary: string;
  teamId: string;
  /** The KPI this goal serves, or null for standalone goals. */
  kpiId: string | null;
  /** Relative completion label, e.g. "2h ago". */
  completedAt: string;
}

// -- grouping ----------------------------------------------------------------

/** 0–100 progress from baseline toward target (direction-agnostic, clamped). */
export function kpiPct(k: PendingKpi): number {
  if (k.target === k.baseline) return 100;
  const frac = (k.current - k.baseline) / (k.target - k.baseline);
  return Math.round(Math.min(1, Math.max(0, frac)) * 100);
}

export interface KpiGroup {
  /** null = the standalone (no-KPI) bucket. */
  kpi: PendingKpi | null;
  goals: PendingGoal[];
}

/** Group goals by the KPI they serve; standalone goals last. */
export function groupByKpi(goals: PendingGoal[], kpis: PendingKpi[]): KpiGroup[] {
  const byId = new Map(kpis.map((k) => [k.id, k]));
  const buckets = new Map<string, PendingGoal[]>();
  const standalone: PendingGoal[] = [];
  for (const g of goals) {
    if (g.kpiId && byId.has(g.kpiId)) {
      const arr = buckets.get(g.kpiId) ?? [];
      arr.push(g);
      buckets.set(g.kpiId, arr);
    } else {
      standalone.push(g);
    }
  }
  const groups: KpiGroup[] = [];
  for (const k of kpis) {
    const gs = buckets.get(k.id);
    if (gs && gs.length) groups.push({ kpi: k, goals: gs });
  }
  if (standalone.length) groups.push({ kpi: null, goals: standalone });
  return groups;
}

export interface ProjectGroup {
  project: PendingProject;
  /** KPI sub-groups within the project (standalone bucket last). */
  kpiGroups: KpiGroup[];
  /** Total pending goals in the project (rollup). */
  total: number;
  /** Distinct teams that contributed (rollup chip). */
  teams: number;
}

/** Group goals by PROJECT, then KPI sub-groups within each project. */
export function groupByProjectThenKpi(
  goals: PendingGoal[],
  kpis: PendingKpi[],
  projects: PendingProject[],
): ProjectGroup[] {
  const out: ProjectGroup[] = [];
  for (const project of projects) {
    const pGoals = goals.filter((g) => g.projectId === project.id);
    if (pGoals.length === 0) continue;
    const pKpis = kpis.filter((k) => goals.some((g) => g.kpiId === k.id && g.projectId === project.id));
    out.push({
      project,
      kpiGroups: groupByKpi(pGoals, pKpis),
      total: pGoals.length,
      teams: new Set(pGoals.map((g) => g.teamId)).size,
    });
  }
  return out;
}

// -- live adapter ------------------------------------------------------------

export interface AcceptanceData {
  goals: PendingGoal[];
  teams: PendingTeam[];
  kpis: PendingKpi[];
  projects: PendingProject[];
}

const TEAM_PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

function teamColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length] ?? '#6366f1';
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase() || '··';
  const a = words[0]?.[0] ?? '';
  const b = words[1]?.[0] ?? '';
  return ((a + b).toUpperCase()) || '··';
}

function rel(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, (Date.now() - t) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const UNASSIGNED_ID = '__unassigned';

/** Map the backend's flat enriched rows into the grouped view-model. Dedupes
 *  the team / KPI / project dimensions; goals reference them by id. */
export function adaptPendingAcceptance(rows: PendingAcceptanceGoal[]): AcceptanceData {
  const teams = new Map<string, PendingTeam>();
  const kpis = new Map<string, PendingKpi>();
  const projects = new Map<string, PendingProject>();
  const goals: PendingGoal[] = [];

  for (const r of rows) {
    projects.set(r.project_id, { id: r.project_id, name: r.project_name });

    const teamId = r.team_id ?? UNASSIGNED_ID;
    if (!teams.has(teamId)) {
      teams.set(teamId, r.team_id
        ? { id: r.team_id, name: r.team_name ?? 'Team', color: teamColor(r.team_id), monogram: monogram(r.team_name ?? 'Team') }
        : { id: UNASSIGNED_ID, name: 'Unassigned', color: 'var(--muted-foreground)', monogram: '··' });
    }

    const kpiMeasured = r.kpi_id != null && r.kpi_current != null && r.kpi_target != null;
    if (kpiMeasured && !kpis.has(r.kpi_id!)) {
      const dir: 'up' | 'down' = r.kpi_direction === 'down' ? 'down' : 'up';
      const current = r.kpi_current!;
      const target = r.kpi_target!;
      kpis.set(r.kpi_id!, {
        id: r.kpi_id!,
        name: r.kpi_name ?? 'KPI',
        unit: r.kpi_unit ?? '',
        direction: dir,
        baseline: r.kpi_baseline ?? current,
        current,
        target,
        offTrack: dir === 'up' ? current < target : current > target,
      });
    }

    goals.push({
      id: r.goal_id,
      projectId: r.project_id,
      title: r.title,
      summary: r.summary ?? '',
      teamId,
      kpiId: kpiMeasured ? r.kpi_id! : null,
      completedAt: rel(r.completed_at),
    });
  }

  return { goals, teams: [...teams.values()], kpis: [...kpis.values()], projects: [...projects.values()] };
}

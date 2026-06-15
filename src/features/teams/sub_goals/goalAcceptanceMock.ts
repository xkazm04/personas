// Throwaway prototype data for the Goal Acceptance View (the human-acceptance
// queue for agent-completed goals). Models the real domain shape so the three
// directional variants can prove the UX before we wire live state:
//   team (column)  ×  completed goal (row)  ·  subtly grouped by the KPI it serves
//
// Real wiring later: teams come from `dev_tools_goal_advancing_teams` /
// team_assignments; the KPI from `dev_goals.kpi_id` → `getKpi`; "completed
// awaiting acceptance" is the new `awaiting_acceptance` status (see the state-
// management plan). For the prototype these are inline so the variants render
// against representative data with no store dependency.

export interface PendingTeam {
  id: string;
  name: string;
  /** Semantic-ish accent (CSS color) — the team's column tint. */
  color: string;
  /** 2-letter monogram for the avatar. */
  monogram: string;
}

export interface PendingKpi {
  id: string;
  name: string;
  unit: string;
  direction: 'up' | 'down';
  baseline: number;
  current: number;
  target: number;
  /** Pre-computed (the real view derives this from kpiMath.kpiTrack). */
  offTrack: boolean;
}

export interface PendingGoal {
  id: string;
  title: string;
  /** One-line of what the team actually shipped (the agent's outcome summary). */
  summary: string;
  teamId: string;
  /** The KPI this goal serves, or null for standalone goals. */
  kpiId: string | null;
  /** Relative completion label, e.g. "2h ago". */
  completedAt: string;
  /** Merged PRs the agent landed for this goal — a credibility signal. */
  prs: number;
}

export const MOCK_TEAMS: PendingTeam[] = [
  { id: 't-sdlc', name: 'SDLC Core', color: '#3b82f6', monogram: 'SC' },
  { id: 't-growth', name: 'Growth Squad', color: '#10b981', monogram: 'GS' },
  { id: 't-quality', name: 'Quality Guild', color: '#f59e0b', monogram: 'QG' },
  { id: 't-platform', name: 'Platform Ops', color: '#a855f7', monogram: 'PO' },
];

export const MOCK_KPIS: PendingKpi[] = [
  { id: 'k-cov', name: 'Billing test coverage', unit: '%', direction: 'up', baseline: 31, current: 38, target: 70, offTrack: true },
  { id: 'k-signup', name: 'Signup conversion', unit: '%', direction: 'up', baseline: 4.1, current: 4.4, target: 6.5, offTrack: true },
  { id: 'k-latency', name: 'p95 checkout latency', unit: 'ms', direction: 'down', baseline: 980, current: 540, target: 400, offTrack: false },
];

export const MOCK_PENDING_GOALS: PendingGoal[] = [
  // Billing coverage (off-track) — two teams pushed on it.
  { id: 'g-1', title: 'Add integration tests for the statement generator', summary: 'Wrote 24 tests across the billing statement path; coverage 31→48% in that module.', teamId: 't-sdlc', kpiId: 'k-cov', completedAt: '2h ago', prs: 2 },
  { id: 'g-2', title: 'Cover the refund + proration edge cases', summary: 'Added property tests for proration rounding and partial refunds; closed 3 untested branches.', teamId: 't-quality', kpiId: 'k-cov', completedAt: '5h ago', prs: 1 },
  // Signup conversion (off-track) — growth + a platform assist.
  { id: 'g-3', title: 'Shorten the signup form to 3 fields', summary: 'Dropped company/role/phone from step 1; deferred to post-signup. A/B scaffolding in place.', teamId: 't-growth', kpiId: 'k-signup', completedAt: '1d ago', prs: 3 },
  { id: 'g-4', title: 'Add social login (Google + GitHub)', summary: 'Wired OAuth via Clerk; both providers live behind a feature flag on staging.', teamId: 't-sdlc', kpiId: 'k-signup', completedAt: '1d ago', prs: 2 },
  // Latency (on-track) — single team.
  { id: 'g-5', title: 'Cache the cart-totals computation', summary: 'Memoised line-item totals + added a 30s edge cache; p95 980→540ms locally.', teamId: 't-platform', kpiId: 'k-latency', completedAt: '3h ago', prs: 1 },
  // Standalone (no KPI link).
  { id: 'g-6', title: 'Upgrade the app to React 19', summary: 'Bumped React + adjusted 11 effect-cleanup sites; full suite green.', teamId: 't-sdlc', kpiId: null, completedAt: '6h ago', prs: 4 },
  { id: 'g-7', title: 'Ship audit-log CSV export', summary: 'Added the export endpoint + a download button to the admin settings page.', teamId: 't-quality', kpiId: null, completedAt: '2d ago', prs: 1 },
];

// -- derivations the variants share ------------------------------------------

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

/** Group pending goals by the KPI they serve; standalone goals last. Groups
 *  preserve KPI declaration order; the standalone bucket is appended if any. */
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

/** Per-team completed count (drives column headers + the "who shipped most"). */
export function countByTeam(goals: PendingGoal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of goals) m.set(g.teamId, (m.get(g.teamId) ?? 0) + 1);
  return m;
}

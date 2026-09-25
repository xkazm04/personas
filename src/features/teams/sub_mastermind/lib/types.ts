// Mastermind canvas — shared scene model. One Island per project (core +
// orbiting dimension nodes), edges where projects are integrated. Derived from
// App Readiness Passports (teams/sub_factory/passport) and the cross-project
// relation map. Pure view model — no store or IPC access here.

export type IslandState = 'healthy' | 'building' | 'warning' | 'critical';

// `unknown` is distinct from `absent`: absent = "we looked, this wiring isn't
// there" (an honest zero); unknown = "the data family that feeds this cell
// failed to load, so we genuinely don't know" — never rendered as a fake
// absent/never-scanned. Its ink is a muted amber-grey (see DIM_INK).
export type DimStatus = 'absent' | 'solid' | 'partial' | 'risk' | 'alert' | 'unknown';

// DimKey is derived from the dimension registry (the single source of truth for
// the dimension system) so a new registry entry extends the key space with no
// edit here. Type-only import → no runtime cycle (dimRegistry imports DimStatus
// from this file, also type-only). Imported for local use AND re-exported.
import type { DimKey } from './dimRegistry';
import type { IslandStat } from './islandStats';

export type { DimKey };

/** One open Fleet CLI session docked to a project island. Colour resolves from
 *  `state` (FleetSessionState) at render time via FLEET_INK. */
export interface FleetNode {
  id: string;
  label: string;
  state: string;
}

/** One in-flight dev-runner task docked to a project island. Reduced from
 *  `DevTask` to just what the canvas paints — the Run Desk owns the full row. */
export interface RunnerNode {
  id: string;
  title: string;
  /** `running` | `queued` (the scene store filters out finished statuses). */
  status: string;
  /** 0–100. Meaningful only while `running`; a queued task has not started. */
  progress: number;
}

export interface DimNode {
  key: DimKey;
  label: string;
  status: DimStatus;
  /** Concrete tool/engine naming (Postgres, Sentry, GitHub Actions…) — the passport deliberately names tools. */
  detail: string | null;
  /** Ordinal progress within the dimension's scale; 0/0 for boolean dimensions. */
  reached: number;
  steps: number;
  /** Passport-wall row key this dimension maps to (page-decorated; null = no
   *  wall counterpart, e.g. auth/kpi). */
  rowKey?: string | null;
  /** Improve action available for this cell (page-decorated from the engine):
   *  standards = Tier-0 config popover, deploy = Claude deploy/connector/skills
   *  popover, ideas = the idea-scan dispatch popover, goals = the active-goal
   *  list popover, null = inert (no click, no hover affordance). */
  action?: 'standards' | 'deploy' | 'ideas' | 'goals' | 'kpi' | 'stack-list' | 'skills-run' | null;
  /** Ideas dimension only: whole days since the last idea scan (null = never). */
  days?: number | null;
  /** An action we dispatched for this cell is still in flight (Ideas scan) —
   *  the cell pulses so the feedback lives where the click happened. */
  busy?: boolean;
}

/** Ship-milestone summary for the banner chip — reduced from the project's
 *  dev_milestones rows (batched wall-summary IPC + buildCoverRoadmap; the page
 *  attaches it). Absent/undefined = no milestones planned (or a demo island). */
export interface IslandShip {
  /** Next milestone name (active before planned); null once everything shipped. */
  next: string | null;
  /** Whether that next milestone has been CUT (`active`) or is still `planned`.
   *  The status bar says which, because "cut" and "planned" are different kinds
   *  of open: a cut milestone has a frozen scope you are executing against. */
  nextStatus: 'active' | 'planned' | null;
  shipped: number;
  total: number;
  /** The next milestone's own target date (`YYYY-MM-DD`), when one is set. */
  targetDate: string | null;
  /** Cycle-time forecast for it, derived from this project's own cut-to-ship
   *  history. Null below the evidence bar — see shipVelocity. */
  forecastDate: string | null;
  /** Velocity forecast says the next milestone lands past its target date. */
  late: boolean;
  /**
   * The next unshipped milestones in plan order, cut/active first — at most
   * three. This is the WORK REMAINING, which is what a reader zoomed in on one
   * island is actually asking about; the `next`/`shipped`/`total` fields above
   * answer the portfolio-distance question ("is this project moving") and say
   * nothing about what comes after the current cut.
   *
   * Empty when everything is shipped, and absent on older payloads.
   */
  upcoming?: Array<{ name: string; status: 'active' | 'planned' }>;
}

export interface Island {
  slug: string;
  name: string;
  purpose: string;
  state: IslandState;
  autoScore: number;
  prodScore: number;
  lifecycle: string;
  automationLabel: string;
  blockers: number;
  nodes: DimNode[];
  /** Open Fleet CLI sessions working in this project (page attaches them). */
  fleet: FleetNode[];
  /** Names of personas with an execution in progress for this project's team
   *  (page attaches them — same persona→team→project join the Monitor uses). */
  personasRunning: string[];
  /** In-flight dev-runner tasks on this project (page attaches them from the
   *  scene store's `runners` family). The third live-process lane: engine work
   *  with no terminal and no persona attached. */
  runners: RunnerNode[];
  /** Live "needs you" marker — true when a fleet session on this project is
   *  awaiting input or has gone stale (page attaches it from the resolved
   *  fleet). Rendered at every zoom band on the counter-scaled banner. */
  attention: boolean;
  /** Live unresolved-issue count from the bound monitoring credential, or null
   *  when no supported credential is bound (honestly unknown → readiness-only
   *  colour). Surfaced in the Monitoring cell detail. */
  monitorErrors: number | null;
  /** What drove `state`: static readiness scores, or a live monitoring signal
   *  (fresh errors / open issues). Named in the banner tooltip. */
  stateSource: 'readiness' | 'errors';
  /** The six side-column stats — real sensors for live projects (KPI
   *  attainment, live errors, 30d LLM spend, tests/auto/prod from the
   *  passport), deterministic mocks for demo islands. */
  stats: IslandStat[];
  /** Ship-milestone chip data (page attaches it; undefined = no milestones). */
  ship?: IslandShip | null;
  /**
   * Painted from the project row alone, before its scan resolved. Every cell is
   * `unknown` and every number is a placeholder — the island exists so the
   * canvas can show its real population immediately, and it sharpens in place
   * when the measured passport lands. Renderers must not read a provisional
   * island's scores as findings.
   */
  provisional?: boolean;
}

export interface IslandEdge {
  from: string;
  to: string;
  kind: 'relation' | 'similarity';
  /** 0..1 — explicit relations are 1, similarity edges carry the similarity. */
  strength: number;
  label: string | null;
}

export interface Scene {
  islands: Island[];
  edges: IslandEdge[];
  /** True when rendering the built-in demo scene (no scanned projects yet). */
  demo: boolean;
}

// Zoom bands — the single source of truth for level-of-detail. Round-3 split:
// the old NEAR secretly contained two levels (labels vs details); `close` makes
// that explicit so each band can be tuned independently from user feedback.
export type ZoomBand = 'far' | 'mid' | 'near' | 'close';


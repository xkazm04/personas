// The fold behind the Dev Tools overview's portfolio strip.
//
// `useDevToolsActions` has wrapped getPortfolioHealth / getTechRadar /
// getRiskMatrix since they were written, labelled "Portfolio Intelligence
// (Direction 5)", and NOTHING called them: a grep found the wrappers and the
// API file and no consumer at all. Three live Tauri commands answered a question
// the app never asked.
//
// Kept pure and separate so the three payloads can be gated without rendering.
import type {
  PortfolioHealthSummary,
  RiskMatrixEntry,
  TechRadarEntry,
} from '@/api/devTools/devTools';

/**
 * The radar bucket worth an operator's attention.
 *
 * The backend's vocabulary is adopt / trial / assess (a share of >60% of
 * projects, >1 project, or exactly one) — there is no "hold" ring, so this
 * names the real bucket rather than a ring that does not exist: a technology
 * exactly one project uses, which is where fleet-wide drift starts.
 */
const ATTENTION_RING = 'assess';

/** Severities the risk matrix emits that an operator should see on the strip. */
const LOUD_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high']);

export interface PortfolioStripModel {
  /**
   * Mean health across the fleet, or `null` when nothing has been scored.
   * NEVER 0: an unscored portfolio and a portfolio scoring zero are opposite
   * facts and the tile must not paint them the same.
   */
  health: number | null;
  projects: number;
  activeProjects: number;
  /** Technologies exactly one project uses. */
  radarAssess: TechRadarEntry[];
  /** Risk rows at high or critical severity, loudest first. */
  highRisk: RiskMatrixEntry[];
  /**
   * True when there is nothing to say. The strip hides itself rather than
   * rendering three zeros over an empty portfolio.
   */
  empty: boolean;
}

export function foldPortfolioStrip(
  health: PortfolioHealthSummary,
  radar: readonly TechRadarEntry[],
  risk: readonly RiskMatrixEntry[],
): PortfolioStripModel {
  const radarAssess = radar.filter((r) => r.status === ATTENTION_RING);
  const highRisk = [...risk.filter((r) => LOUD_SEVERITIES.has(r.severity))].sort(
    (a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'),
  );
  return {
    health: typeof health.avg_health_score === 'number' ? health.avg_health_score : null,
    projects: health.total_projects,
    activeProjects: health.active_projects,
    radarAssess,
    highRisk,
    // One project is a portfolio of one: there is no cross-project answer to
    // give, so the strip stays out of the way.
    empty: health.total_projects < 2,
  };
}

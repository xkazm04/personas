import { describe, expect, it } from 'vitest';
import { foldPortfolioStrip } from '../portfolioStrip';
import type {
  PortfolioHealthSummary,
  RiskMatrixEntry,
  TechRadarEntry,
} from '@/api/devTools/devTools';

/**
 * Sweep #371 — getPortfolioHealth / getTechRadar / getRiskMatrix were wrapped in
 * `useDevToolsActions` and called by nothing. Three live Tauri commands answered
 * a question the app never asked.
 */

const health = (over: Partial<PortfolioHealthSummary> = {}): PortfolioHealthSummary => ({
  total_projects: 3,
  active_projects: 3,
  total_ideas: 0,
  pending_ideas: 0,
  total_tasks: 0,
  running_tasks: 0,
  projects: [],
  ...over,
});

const radar = (technology: string, status: string): TechRadarEntry => ({
  technology,
  category: 'lang',
  project_count: status === 'assess' ? 1 : 3,
  project_names: [],
  status,
});

const risk = (project_name: string, severity: string): RiskMatrixEntry => ({
  project_id: project_name,
  project_name,
  risk_category: 'security',
  severity,
  description: '2 high-risk ideas pending review',
  affected_contexts: [],
});

describe('foldPortfolioStrip', () => {
  it('reports an unscored fleet as null, never as a health of 0', () => {
    const m = foldPortfolioStrip(health(), [], []);
    expect(m.health).toBeNull();
  });

  it('keeps a real zero when one was measured', () => {
    const m = foldPortfolioStrip(health({ avg_health_score: 0 }), [], []);
    expect(m.health).toBe(0);
  });

  it('counts only the technologies exactly one project carries', () => {
    const m = foldPortfolioStrip(
      health({ avg_health_score: 72 }),
      [radar('rust', 'assess'), radar('react', 'adopt'), radar('bun', 'assess')],
      [],
    );
    expect(m.radarAssess.map((r) => r.technology)).toEqual(['rust', 'bun']);
  });

  it('keeps only loud risks and puts critical first', () => {
    const m = foldPortfolioStrip(health(), [], [
      risk('alpha', 'high'),
      risk('beta', 'low'),
      risk('gamma', 'critical'),
    ]);
    expect(m.highRisk.map((r) => r.project_name)).toEqual(['gamma', 'alpha']);
  });

  it('hides itself on a portfolio of one, where there is no cross-project answer', () => {
    expect(foldPortfolioStrip(health({ total_projects: 1 }), [], []).empty).toBe(true);
    expect(foldPortfolioStrip(health({ total_projects: 0 }), [], []).empty).toBe(true);
    expect(foldPortfolioStrip(health({ total_projects: 2 }), [], []).empty).toBe(false);
  });
});

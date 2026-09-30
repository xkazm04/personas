// Every word the composed Factory surfaces show. Catalog keys where one already
// says the same thing; the rest is `LOCAL`: the English the Factory rendered
// before the kit port, kept in one place. The Factory has never had an i18n
// pass (factoryModel.ts says so) and this port adds no catalog strings, so the
// owed pass now has one list to translate instead of literals across ten files.
import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { KpiStatus } from './factoryModel';
import type { FocusKind } from './factoryTone';

export const LOCAL = {
  readiness: 'Project readiness',
  projectsCount: 'projects',
  scanned: 'scanned',
  passportsFailed: "Couldn't build project passports",
  noProjects: 'No projects to compare yet',
  noProjectsHint: 'Register a project in Dev-Tools and scan its context map, then Rescan to build its readiness passport.',
  switchProject: 'Switch project',
  offTrack: 'off-track',
  matrix: 'KPI matrix',
  atRisk: 'At risk',
  setup: 'setup',
  scanFeatures: 'Scan features',
  rescanContexts: 'Re-scan contexts',
  fullScan: 'Full scan',
  proposed: 'Proposed KPIs',
  noProposed: 'No proposed KPIs',
  unassigned: 'unassigned',
  scanContext: 'Scan this context',
  scanContextNote: (name: string) => `Per-context scan for "${name}" arrives with the unified dispatch concept. Use Dev Tools, Idea Scanner meanwhile.`,
  worstKpi: 'Worst KPI',
  ofTarget: 'of target',
  notWired: 'not wired',
  noContexts: 'No contexts scanned yet',
  noContextsHint: 'Run a Full scan from the toolbar (or Dev Tools, Context Map) to light this grid.',
  decided: (name: string, accepted: boolean) => `"${name}" ${accepted ? 'accepted' : 'rejected'}`,
  llmSpend: 'LLM spend by feature',
  window30d: '30d',
  errorsTitle: 'Monitoring: unresolved errors',
  wireAsk: (what: string) => `${what} is not wired. Bind a connector on the project (Passport wall, Tooling rows) to light this panel.`,
  llmTracking: 'LLM tracking',
  noLlm: 'No traced LLM calls in the last 30 days.',
  noIssues: 'No unresolved issues, clear.',
  features: 'features',
  issues: 'unresolved issues',
  events: 'events',
  calls: 'calls',
  moreFeatures: (n: number) => `+${n} more features`,
  moreIssues: (n: number) => `+${n} more issues`,
  untagged: (model: string) => `(untagged · ${model})`,
  toTarget: 'to target',
  measurement: 'Measurement',
  methodic: 'Methodic',
  noMethodic: '(no methodic configured)',
  lastMeasured: 'Last measured',
  calibrate: 'Calibrate thresholds',
  assess: 'Assess',
  yellow: 'Yellow, at risk',
  red: 'Red, off track',
  overToYou: 'The system looked and found nothing it can build for this right now. Over to you.',
  measured: (v: string) => `Measured ${v} saved`,
  kpisCount: 'KPIs',
  score: 'Score',
  rating: 'Rating',
  value: 'Value',
  pros: "Pros: what's working",
  cons: "Cons: what's off",
  prosHint: 'Strengths of this signal…',
  consHint: 'Caveats, gaps, risks…',
  rated: (n: number) => `${n}/5 confidence`,
  unrated: 'not yet rated',
  domain: 'Domain',
} as const;

export function useFactoryWords() {
  const { t, tx } = useTranslation();
  return useMemo(() => {
    const status: Record<KpiStatus, string> = {
      met: t.kpis.track_met,
      ok: t.kpis.track_on,
      warn: LOCAL.atRisk,
      crit: t.kpis.track_off,
      unmeasured: t.kpis.track_unmeasured,
    };
    const kind: Record<FocusKind, string> = {
      crit: t.overview.health.critical,
      warn: t.overview.health.warning,
      setup: LOCAL.setup,
      ok: t.agents.status.healthy,
    };
    return {
      t, tx, status, kind, L: LOCAL,
      factory: t.sidebar.factory,
      projects: t.sidebar.projects,
      overview: t.sidebar.overview,
      observability: t.overview.observability.title,
      contexts: t.athena.decisions_atlas_contexts,
      context: t.monitor.context,
      features: t.sidebar.features,
      goals: t.sidebar.goals,
      kpis: t.sidebar.kpis,
      kpi: t.kpis.col_kpi,
      cost: t.agents.executions.col_cost,
      errors: t.overview.widgets.tool_performance_col_errors,
      trend: t.director.roster_col_trend,
      baseline: t.kpis.overview.baseline,
      target: t.kpis.overview.target,
      current: t.kpis.overview.current,
      ungrouped: t.kpis.overview.ungrouped,
      monitoring: t.sidebar.group_monitoring,
      model: t.common.model_label,
      none: t.common.none,
      eyebrow: `${t.sidebar.factory} · ${t.sidebar.projects}`,
    };
  }, [t, tx]);
}

export type FactoryWords = ReturnType<typeof useFactoryWords>;

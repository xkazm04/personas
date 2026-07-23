// AppPassport[] + cross-project metadata → Mastermind Scene.
// Node statuses follow the passport's "null is a first-class answer" doctrine:
// absent wiring is rendered greyed, never hidden. When no projects have been
// scanned yet, a built-in demo scene keeps the canvas evaluable.
import type { CrossProjectMetadataMap } from '@/api/devTools/devTools';
import {
  AUTOMATION_LABEL, LIFECYCLE_LABEL, type AppPassport,
} from '@/features/teams/sub_factory/passport/passportModel';

import { DIM_ORDER, DIM_REGISTRY, type KpiRollup } from './dimRegistry';
import { spiralPlace } from './hex';
import { combineIslandState, type MonitoringSummary } from './liveState';
import type { DimNode, DimStatus, FleetNode, Island, IslandEdge, IslandState, Scene } from './types';

// KpiRollup's home is the registry (its Ideas/KPI derive functions consume it);
// re-exported here so existing importers (MastermindPage) keep their path.
export type { KpiRollup } from './dimRegistry';

/** All dimension nodes for a project, in registry order — each dimension's
 *  status/detail/progress comes from its own registry `derive()`. */
function dimNodes(p: AppPassport, kpi: KpiRollup | undefined, lastScanAt: string | null | undefined, monitorErrors: number | null | undefined): DimNode[] {
  return DIM_ORDER.map((key) => {
    const entry = DIM_REGISTRY[key];
    const d = entry.derive(p, { kpi, lastScanAt, monitorErrors });
    return { key, label: entry.label, status: d.status, detail: d.detail, reached: d.reached, steps: d.steps, days: d.days ?? null };
  });
}

/** Static readiness state — the worst of the two readiness scores. */
function readinessState(p: AppPassport): IslandState {
  const worst = Math.min(p.automationReadiness.score, p.productionReadiness.score);
  if (worst >= 78) return 'healthy';
  if (worst >= 55) return 'building';
  if (worst >= 35) return 'warning';
  return 'critical';
}

function toIsland(p: AppPassport, i: number, kpi: KpiRollup | undefined, lastScanAt: string | null | undefined, monitoring: MonitoringSummary | undefined): Island {
  const pos = spiralPlace(i, p.identity.slug);
  // Colour = static readiness combined with the live monitoring signal (fresh
  // errors → critical, quiet-but-open issues → warning). Fleet "attention" is
  // attached by the page from the resolved fleet (default false here).
  const { state, source } = combineIslandState(readinessState(p), monitoring);
  return {
    slug: p.identity.slug,
    name: p.identity.name,
    purpose: p.identity.purpose,
    x: pos.x, y: pos.y,
    state,
    stateSource: source,
    monitorErrors: monitoring?.unresolvedIssues ?? null,
    autoScore: p.automationReadiness.score,
    prodScore: p.productionReadiness.score,
    lifecycle: LIFECYCLE_LABEL[p.identity.lifecycle],
    automationLabel: AUTOMATION_LABEL[p.automationReadiness.level],
    blockers: p.automationReadiness.blockers.length + p.productionReadiness.blockers.length,
    nodes: dimNodes(p, kpi, lastScanAt, monitoring?.unresolvedIssues),
    fleet: [],
    personasRunning: [],
    attention: false,
  };
}

function deriveEdges(meta: CrossProjectMetadataMap | null, have: Set<string>): IslandEdge[] {
  if (!meta) return [];
  const out: IslandEdge[] = [];
  const seen = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('→');
  for (const r of meta.cross_project.relations) {
    if (!have.has(r.source) || !have.has(r.target) || r.source === r.target) continue;
    const k = pairKey(r.source, r.target);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ from: r.source, to: r.target, kind: 'relation', strength: 1, label: r.type });
  }
  for (const s of meta.cross_project.similarity_matrix) {
    if (s.similarity < 0.5 || !have.has(s.source) || !have.has(s.target) || s.source === s.target) continue;
    const k = pairKey(s.source, s.target);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ from: s.source, to: s.target, kind: 'similarity', strength: s.similarity, label: null });
  }
  return out;
}

export function deriveScene(
  passports: AppPassport[],
  meta: CrossProjectMetadataMap | null,
  loading: boolean,
  kpiByProject?: Map<string, KpiRollup>,
  ideaScanAt?: Map<string, string | null>,
  monitoringByProject?: Map<string, MonitoringSummary | undefined>,
): Scene {
  if (passports.length > 0) {
    const islands = passports.map((p, i) => toIsland(p, i, kpiByProject?.get(p.identity.slug), ideaScanAt?.get(p.identity.slug), monitoringByProject?.get(p.identity.slug)));
    return { islands, edges: deriveEdges(meta, new Set(islands.map((i) => i.slug))), demo: false };
  }
  if (loading) return { islands: [], edges: [], demo: false };
  return demoScene();
}

// -- demo scene (rendered only when no projects have been cross-scanned) ------

// Demo in-progress personas so the badge + list are evaluable without live data.
const DEMO_PERSONAS: Record<string, string[]> = {
  'demo-desktop': ['Atlas Writer', 'QA Guardian'],
  'demo-vibe': ['Context Cartographer'],
};

type Row = [DimNode['key'], DimStatus, string | null, number, number, (number | null)?];
const mk = (slug: string, name: string, purpose: string, i: number, state: IslandState,
  autoScore: number, prodScore: number, lifecycle: string, automationLabel: string, blockers: number, rows: Row[], fleet: FleetNode[] = []): Island => ({
  slug, name, purpose, ...spiralPlace(i, slug), state, autoScore, prodScore, lifecycle, automationLabel, blockers,
  nodes: rows.map(([key, status, detail, reached, steps, days]) => ({ key, label: DIM_REGISTRY[key].label, status, detail, reached, steps, days: days ?? null })),
  fleet,
  personasRunning: DEMO_PERSONAS[slug] ?? [],
  // Live fields: the page attaches `attention` from the resolved fleet (demo
  // fleet included); colour stays readiness-derived in the demo scene.
  attention: false,
  monitorErrors: null,
  stateSource: 'readiness',
});

function demoScene(): Scene {
  const islands = [
    mk('demo-desktop', 'Atlas Desktop', 'Cross-platform agent workbench', 0, 'healthy', 84, 88, 'GA', 'Integrated', 0, [
      ['db', 'solid', 'SQLite', 0, 0], ['monitoring', 'solid', 'Sentry', 3, 4], ['ci', 'solid', 'GitHub Actions', 3, 5],
      ['tests', 'solid', '81% cov', 4, 4], ['security', 'partial', null, 1, 4], ['hosting', 'solid', 'Installer', 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'solid', 'Integrated', 3, 4],
      ['skills', 'solid', 'installed', 0, 0], ['llm', 'solid', 'connected', 0, 0], ['kpi', 'alert', '2 off-track', 0, 0], ['ideas', 'solid', '2d ago', 0, 0, 2]],
      [{ id: 'demo-f1', label: 'ui-scan', state: 'running' }, { id: 'demo-f2', label: 'i18n-sweep', state: 'awaiting_input' }, { id: 'demo-f6', label: 'doc-sync', state: 'running' }, { id: 'demo-f7', label: 'bench', state: 'idle' }]),
    mk('demo-web', 'Atlas Web', 'Marketing site + mobile dashboard', 1, 'building', 66, 58, 'Beta', 'Augmented', 2, [
      ['db', 'solid', 'Postgres', 0, 0], ['monitoring', 'partial', 'Vercel logs', 1, 4], ['ci', 'solid', 'Vercel', 4, 5],
      ['tests', 'risk', 'smoke', 1, 4], ['security', 'absent', null, 0, 4], ['hosting', 'solid', 'Vercel', 0, 0],
      ['auth', 'solid', 'Clerk', 0, 0], ['agents', 'partial', 'Augmented', 2, 4],
      ['skills', 'absent', null, 0, 0], ['llm', 'solid', 'connected', 0, 0], ['kpi', 'solid', '4 on track', 0, 0], ['ideas', 'risk', '12d ago', 0, 0, 12]],
      [{ id: 'demo-f3', label: 'seo-pass', state: 'idle' }]),
    mk('demo-sonar', 'ChainSonar', 'On-chain anomaly scanner', 2, 'warning', 48, 39, 'Alpha', 'Assisted', 4, [
      ['db', 'partial', 'Mongo', 0, 0], ['monitoring', 'absent', null, 0, 4], ['ci', 'partial', null, 1, 5],
      ['tests', 'absent', null, 0, 4], ['security', 'absent', null, 0, 4], ['hosting', 'solid', 'Fly.io', 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'risk', 'Assisted', 1, 4],
      ['skills', 'absent', null, 0, 0], ['llm', 'absent', null, 0, 0], ['kpi', 'absent', null, 0, 0], ['ideas', 'alert', '45d ago', 0, 0, 45]],
      [{ id: 'demo-f4', label: 'bugfix', state: 'stale' }]),
    mk('demo-codex', 'Codex Companion', 'Personal memory companion', 3, 'critical', 31, 24, 'Prototype', 'Manual', 6, [
      ['db', 'absent', null, 0, 0], ['monitoring', 'absent', null, 0, 4], ['ci', 'absent', null, 0, 5],
      ['tests', 'absent', null, 0, 4], ['security', 'absent', null, 0, 4], ['hosting', 'absent', null, 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'risk', 'Manual', 0, 4],
      ['skills', 'absent', null, 0, 0], ['llm', 'absent', null, 0, 0], ['kpi', 'absent', null, 0, 0], ['ideas', 'absent', null, 0, 0]]),
    mk('demo-vibe', 'Vibeman', 'Context-map generator for repos', 4, 'building', 72, 61, 'Beta', 'Integrated', 1, [
      ['db', 'solid', 'SQLite', 0, 0], ['monitoring', 'partial', 'logs', 1, 4], ['ci', 'solid', 'GitHub Actions', 2, 5],
      ['tests', 'partial', '54% cov', 2, 4], ['security', 'partial', null, 1, 4], ['hosting', 'absent', null, 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'solid', 'Integrated', 3, 4],
      ['skills', 'solid', 'installed', 0, 0], ['llm', 'absent', null, 0, 0], ['kpi', 'solid', '2 on track', 0, 0], ['ideas', 'solid', 'today', 0, 0, 0]],
      [{ id: 'demo-f5', label: 'kb-refresh', state: 'hibernated' }]),
    mk('demo-ascent', 'Ascent', 'AI-native onboarding grader', 5, 'healthy', 90, 79, 'GA', 'Autonomous', 0, [
      ['db', 'solid', 'Postgres', 0, 0], ['monitoring', 'solid', 'Datadog', 4, 4], ['ci', 'solid', 'CircleCI', 4, 5],
      ['tests', 'solid', '88% cov', 3, 4], ['security', 'solid', 'Snyk', 2, 4], ['hosting', 'solid', 'AWS', 0, 0],
      ['auth', 'solid', 'Auth.js', 0, 0], ['agents', 'solid', 'Autonomous', 4, 4],
      ['skills', 'solid', 'installed', 0, 0], ['llm', 'solid', 'connected', 0, 0], ['kpi', 'solid', '6 on track', 0, 0], ['ideas', 'risk', '9d ago', 0, 0, 9]]),
  ];
  const edges: IslandEdge[] = [
    { from: 'demo-desktop', to: 'demo-web', kind: 'relation', strength: 1, label: 'shares API' },
    { from: 'demo-desktop', to: 'demo-vibe', kind: 'relation', strength: 1, label: 'context map' },
    { from: 'demo-web', to: 'demo-ascent', kind: 'similarity', strength: 0.62, label: null },
    { from: 'demo-sonar', to: 'demo-codex', kind: 'similarity', strength: 0.55, label: null },
  ];
  return { islands, edges, demo: true };
}

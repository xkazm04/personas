// AppPassport[] + cross-project metadata → Mastermind Scene.
// Node statuses follow the passport's "null is a first-class answer" doctrine:
// absent wiring is rendered greyed, never hidden. When no projects have been
// scanned yet, a built-in demo scene keeps the canvas evaluable.
import type { CrossProjectMetadataMap } from '@/api/devTools/devTools';
import {
  AUTOMATION_LABEL, AUTOMATION_SCALE, CI_SCALE, LIFECYCLE_LABEL,
  OBSERVABILITY_SCALE, SECURITY_SCALE, TESTS_SCALE,
  type AppPassport,
} from '@/features/teams/sub_factory/passport/passportModel';

import { spiralPlace } from './hex';
import type { DimNode, DimStatus, FleetNode, Island, IslandEdge, IslandState, Scene } from './types';

// Prototype-stage copy (local COPY const, mirroring ProjectsPassportWall) —
// consolidation wires these through i18n.
const LABEL = {
  db: 'Database', monitoring: 'Monitoring', ci: 'CI', tests: 'Tests',
  security: 'Security', hosting: 'Hosting', auth: 'Auth', agents: 'Agents',
  skills: 'Skills', llm: 'LLM cost', kpi: 'KPIs',
} as const;

/** Per-project KPI rollup (Factory data): total active KPIs + off-track count. */
export interface KpiRollup { total: number; off: number }

const ord = <T extends string>(scale: T[], v: T) => {
  const i = Math.max(0, scale.indexOf(v));
  return { reached: i, steps: scale.length - 1, pos: scale.length > 1 ? i / (scale.length - 1) : 0 };
};

function dimNodes(p: AppPassport, kpi: KpiRollup | undefined): DimNode[] {
  const { stack, productionReadiness: prod, automationReadiness: auto } = p;
  const db = stack.persistence.filter((x) => x.kind !== 'none');
  const monTools = [stack.monitoring.errorTracking, stack.monitoring.logs, stack.monitoring.metrics, stack.monitoring.tracing]
    .filter((x): x is string => Boolean(x));
  const obs = ord(OBSERVABILITY_SCALE, prod.observability.level);
  const ci = ord(CI_SCALE, prod.ci.level);
  const tests = ord(TESTS_SCALE, prod.tests.level);
  const sec = ord(SECURITY_SCALE, prod.security.level);
  const agents = ord(AUTOMATION_SCALE, auto.level);
  const presence = (v: string | null | undefined): DimStatus => (v ? 'solid' : 'absent');

  return [
    {
      key: 'db', label: LABEL.db,
      status: db.length === 0 ? 'absent' : db.some((x) => x.migrations && x.migrations !== 'none') ? 'solid' : 'partial',
      detail: db.map((x) => x.engine ?? x.kind).join(' · ') || null,
      reached: 0, steps: 0,
    },
    {
      key: 'monitoring', label: LABEL.monitoring,
      status: monTools.length === 0 && obs.reached === 0 ? 'absent' : obs.pos >= 0.5 ? 'solid' : 'partial',
      detail: monTools[0] ?? null,
      reached: obs.reached, steps: obs.steps,
    },
    {
      key: 'ci', label: LABEL.ci,
      status: ci.reached === 0 ? 'absent' : ci.pos >= 0.5 ? 'solid' : 'partial',
      detail: prod.ci.provider ?? null,
      reached: ci.reached, steps: ci.steps,
    },
    {
      key: 'tests', label: LABEL.tests,
      status: tests.reached === 0 ? 'absent' : tests.pos >= 0.7 ? 'solid' : tests.pos >= 0.5 ? 'partial' : 'risk',
      detail: prod.tests.coveragePct != null ? `${prod.tests.coveragePct}% cov` : prod.tests.frameworks?.[0] ?? null,
      reached: tests.reached, steps: tests.steps,
    },
    {
      key: 'security', label: LABEL.security,
      status: sec.reached === 0 ? 'absent' : sec.pos >= 0.5 ? 'solid' : 'partial',
      detail: prod.security.tools?.[0] ?? null,
      reached: sec.reached, steps: sec.steps,
    },
    { key: 'hosting', label: LABEL.hosting, status: presence(stack.hosting), detail: stack.hosting ?? null, reached: 0, steps: 0 },
    { key: 'auth', label: LABEL.auth, status: presence(stack.auth), detail: stack.auth ?? null, reached: 0, steps: 0 },
    {
      key: 'agents', label: LABEL.agents,
      status: agents.pos >= 0.75 ? 'solid' : agents.pos >= 0.5 ? 'partial' : 'risk',
      detail: AUTOMATION_LABEL[auto.level],
      reached: agents.reached, steps: agents.steps,
    },
    // Round-4 additions from the Factory/Passport surface:
    { key: 'skills', label: LABEL.skills, status: auto.artifacts.skills ? 'solid' : 'absent', detail: auto.artifacts.skills ? 'installed' : null, reached: 0, steps: 0 },
    { key: 'llm', label: LABEL.llm, status: stack.llmTracking ? 'solid' : 'absent', detail: stack.llmTracking ?? null, reached: 0, steps: 0 },
    {
      key: 'kpi', label: LABEL.kpi,
      status: !kpi || kpi.total === 0 ? 'absent' : kpi.off > 0 ? 'alert' : 'solid',
      detail: !kpi || kpi.total === 0 ? null : kpi.off > 0 ? `${kpi.off} off-track` : `${kpi.total} on track`,
      reached: 0, steps: 0,
    },
  ];
}

function islandState(p: AppPassport): IslandState {
  const worst = Math.min(p.automationReadiness.score, p.productionReadiness.score);
  if (worst >= 78) return 'healthy';
  if (worst >= 55) return 'building';
  if (worst >= 35) return 'warning';
  return 'critical';
}

function toIsland(p: AppPassport, i: number, kpi: KpiRollup | undefined): Island {
  const pos = spiralPlace(i, p.identity.slug);
  return {
    slug: p.identity.slug,
    name: p.identity.name,
    purpose: p.identity.purpose,
    x: pos.x, y: pos.y,
    state: islandState(p),
    autoScore: p.automationReadiness.score,
    prodScore: p.productionReadiness.score,
    lifecycle: LIFECYCLE_LABEL[p.identity.lifecycle],
    automationLabel: AUTOMATION_LABEL[p.automationReadiness.level],
    blockers: p.automationReadiness.blockers.length + p.productionReadiness.blockers.length,
    nodes: dimNodes(p, kpi),
    fleet: [],
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
): Scene {
  if (passports.length > 0) {
    const islands = passports.map((p, i) => toIsland(p, i, kpiByProject?.get(p.identity.slug)));
    return { islands, edges: deriveEdges(meta, new Set(islands.map((i) => i.slug))), demo: false };
  }
  if (loading) return { islands: [], edges: [], demo: false };
  return demoScene();
}

// -- demo scene (rendered only when no projects have been cross-scanned) ------

type Row = [DimNode['key'], DimStatus, string | null, number, number];
const mk = (slug: string, name: string, purpose: string, i: number, state: IslandState,
  autoScore: number, prodScore: number, lifecycle: string, automationLabel: string, blockers: number, rows: Row[], fleet: FleetNode[] = []): Island => ({
  slug, name, purpose, ...spiralPlace(i, slug), state, autoScore, prodScore, lifecycle, automationLabel, blockers,
  nodes: rows.map(([key, status, detail, reached, steps]) => ({ key, label: LABEL[key], status, detail, reached, steps })),
  fleet,
});

function demoScene(): Scene {
  const islands = [
    mk('demo-desktop', 'Atlas Desktop', 'Cross-platform agent workbench', 0, 'healthy', 84, 88, 'GA', 'Integrated', 0, [
      ['db', 'solid', 'SQLite', 0, 0], ['monitoring', 'solid', 'Sentry', 3, 4], ['ci', 'solid', 'GitHub Actions', 3, 5],
      ['tests', 'solid', '81% cov', 4, 4], ['security', 'partial', null, 1, 4], ['hosting', 'solid', 'Installer', 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'solid', 'Integrated', 3, 4],
      ['skills', 'solid', 'installed', 0, 0], ['llm', 'solid', 'connected', 0, 0], ['kpi', 'alert', '2 off-track', 0, 0]],
      [{ id: 'demo-f1', label: 'ui-scan', state: 'running' }, { id: 'demo-f2', label: 'i18n-sweep', state: 'awaiting_input' }, { id: 'demo-f6', label: 'doc-sync', state: 'running' }, { id: 'demo-f7', label: 'bench', state: 'idle' }]),
    mk('demo-web', 'Atlas Web', 'Marketing site + mobile dashboard', 1, 'building', 66, 58, 'Beta', 'Augmented', 2, [
      ['db', 'solid', 'Postgres', 0, 0], ['monitoring', 'partial', 'Vercel logs', 1, 4], ['ci', 'solid', 'Vercel', 4, 5],
      ['tests', 'risk', 'smoke', 1, 4], ['security', 'absent', null, 0, 4], ['hosting', 'solid', 'Vercel', 0, 0],
      ['auth', 'solid', 'Clerk', 0, 0], ['agents', 'partial', 'Augmented', 2, 4],
      ['skills', 'absent', null, 0, 0], ['llm', 'solid', 'connected', 0, 0], ['kpi', 'solid', '4 on track', 0, 0]],
      [{ id: 'demo-f3', label: 'seo-pass', state: 'idle' }]),
    mk('demo-sonar', 'ChainSonar', 'On-chain anomaly scanner', 2, 'warning', 48, 39, 'Alpha', 'Assisted', 4, [
      ['db', 'partial', 'Mongo', 0, 0], ['monitoring', 'absent', null, 0, 4], ['ci', 'partial', null, 1, 5],
      ['tests', 'absent', null, 0, 4], ['security', 'absent', null, 0, 4], ['hosting', 'solid', 'Fly.io', 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'risk', 'Assisted', 1, 4],
      ['skills', 'absent', null, 0, 0], ['llm', 'absent', null, 0, 0], ['kpi', 'absent', null, 0, 0]],
      [{ id: 'demo-f4', label: 'bugfix', state: 'stale' }]),
    mk('demo-codex', 'Codex Companion', 'Personal memory companion', 3, 'critical', 31, 24, 'Prototype', 'Manual', 6, [
      ['db', 'absent', null, 0, 0], ['monitoring', 'absent', null, 0, 4], ['ci', 'absent', null, 0, 5],
      ['tests', 'absent', null, 0, 4], ['security', 'absent', null, 0, 4], ['hosting', 'absent', null, 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'risk', 'Manual', 0, 4],
      ['skills', 'absent', null, 0, 0], ['llm', 'absent', null, 0, 0], ['kpi', 'absent', null, 0, 0]]),
    mk('demo-vibe', 'Vibeman', 'Context-map generator for repos', 4, 'building', 72, 61, 'Beta', 'Integrated', 1, [
      ['db', 'solid', 'SQLite', 0, 0], ['monitoring', 'partial', 'logs', 1, 4], ['ci', 'solid', 'GitHub Actions', 2, 5],
      ['tests', 'partial', '54% cov', 2, 4], ['security', 'partial', null, 1, 4], ['hosting', 'absent', null, 0, 0],
      ['auth', 'absent', null, 0, 0], ['agents', 'solid', 'Integrated', 3, 4],
      ['skills', 'solid', 'installed', 0, 0], ['llm', 'absent', null, 0, 0], ['kpi', 'solid', '2 on track', 0, 0]],
      [{ id: 'demo-f5', label: 'kb-refresh', state: 'hibernated' }]),
    mk('demo-ascent', 'Ascent', 'AI-native onboarding grader', 5, 'healthy', 90, 79, 'GA', 'Autonomous', 0, [
      ['db', 'solid', 'Postgres', 0, 0], ['monitoring', 'solid', 'Datadog', 4, 4], ['ci', 'solid', 'CircleCI', 4, 5],
      ['tests', 'solid', '88% cov', 3, 4], ['security', 'solid', 'Snyk', 2, 4], ['hosting', 'solid', 'AWS', 0, 0],
      ['auth', 'solid', 'Auth.js', 0, 0], ['agents', 'solid', 'Autonomous', 4, 4],
      ['skills', 'solid', 'installed', 0, 0], ['llm', 'solid', 'connected', 0, 0], ['kpi', 'solid', '6 on track', 0, 0]]),
  ];
  const edges: IslandEdge[] = [
    { from: 'demo-desktop', to: 'demo-web', kind: 'relation', strength: 1, label: 'shares API' },
    { from: 'demo-desktop', to: 'demo-vibe', kind: 'relation', strength: 1, label: 'context map' },
    { from: 'demo-web', to: 'demo-ascent', kind: 'similarity', strength: 0.62, label: null },
    { from: 'demo-sonar', to: 'demo-codex', kind: 'similarity', strength: 0.55, label: null },
  ];
  return { islands, edges, demo: true };
}

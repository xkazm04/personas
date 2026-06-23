// The golden-standard RUBRIC — makes "golden" an explicit, tunable spec instead
// of magic numbers buried in the score weights. Each readiness dimension has a
// per-archetype TARGET (a 0..1 position in its scale) and a WEIGHT; a project is
// scored as the weighted % of its targets met, given its own archetype. A solo
// prototype is not held to an org-grade bar — the target scales with the tier,
// which is the whole point of "fair, golden-standard tracking".
import {
  GRAPH_SCALE, CI_SCALE, TESTS_SCALE, SECURITY_SCALE, OBSERVABILITY_SCALE,
  EVALS_SCALE, MIGRATIONS_SCALE, scalePos,
  type AppPassport, type Archetype,
} from '../passportModel';

export interface RubricDim {
  key: string;
  label: string;
  weight: number;
  /** Current attainment 0..1. */
  pos: (p: AppPassport) => number;
  /** Target attainment 0..1, per archetype (solo < team < org). */
  target: Record<Archetype, number>;
}

// Targets are expressed as positions in each dimension's scale so they read
// naturally: e.g. tests team-target 0.75 ≈ "substantial" on the 5-rung tests
// ladder (none·smoke·partial·substantial·comprehensive).
export const RUBRIC: RubricDim[] = [
  {
    key: 'context', label: 'Context graph', weight: 3,
    pos: (p) => scalePos(GRAPH_SCALE, p.automationReadiness.artifacts.contextGraph),
    target: { solo: 0.5, team: 1, org: 1 },
  },
  {
    key: 'instructions', label: 'Agent instructions', weight: 2,
    pos: (p) => (p.automationReadiness.artifacts.agentInstructions.length > 0 ? 1 : 0),
    target: { solo: 1, team: 1, org: 1 },
  },
  {
    key: 'selfverify', label: 'Self-verify locally', weight: 3,
    pos: (p) => {
      const sv = p.automationReadiness.selfVerify;
      return [sv.build, sv.test, sv.lint, sv.typecheck].filter(Boolean).length / 4;
    },
    target: { solo: 0.5, team: 0.75, org: 1 },
  },
  {
    key: 'evals', label: 'Evals', weight: 2,
    pos: (p) => scalePos(EVALS_SCALE, p.automationReadiness.artifacts.evals),
    target: { solo: 0, team: 0.5, org: 1 },
  },
  {
    key: 'skills', label: 'Reusable skills', weight: 1,
    pos: (p) => (p.automationReadiness.artifacts.skills ? 1 : 0),
    target: { solo: 0, team: 1, org: 1 },
  },
  {
    key: 'aiflow', label: 'AI in workflow', weight: 2,
    pos: (p) => (p.automationReadiness.aiInWorkflow ? 1 : 0),
    target: { solo: 0, team: 1, org: 1 },
  },
  {
    key: 'ci', label: 'CI', weight: 3,
    pos: (p) => scalePos(CI_SCALE, p.productionReadiness.ci.level),
    target: { solo: 0.4, team: 0.6, org: 0.8 },
  },
  {
    key: 'tests', label: 'Tests', weight: 3,
    pos: (p) => scalePos(TESTS_SCALE, p.productionReadiness.tests.level),
    target: { solo: 0.25, team: 0.75, org: 1 },
  },
  {
    key: 'security', label: 'Security', weight: 2,
    pos: (p) => scalePos(SECURITY_SCALE, p.productionReadiness.security.level),
    target: { solo: 0.25, team: 0.5, org: 0.75 },
  },
  {
    key: 'observability', label: 'Observability', weight: 2,
    pos: (p) => scalePos(OBSERVABILITY_SCALE, p.productionReadiness.observability.level),
    target: { solo: 0, team: 0.5, org: 1 },
  },
  {
    key: 'migrations', label: 'Migrations', weight: 1,
    pos: (p) => scalePos(MIGRATIONS_SCALE, p.productionReadiness.delivery.migrations),
    target: { solo: 0.5, team: 1, org: 1 },
  },
];

export interface RubricDimResult {
  key: string;
  label: string;
  current: number;
  target: number;
  weight: number;
  /** 0..1 progress toward target (1 when met or no target). */
  progress: number;
  met: boolean;
}

export interface RubricResult {
  archetype: Archetype;
  /** Weighted % of targets met, 0..100. */
  goldenPct: number;
  dims: RubricDimResult[];
  /** Dimensions still under target, weakest-first — the work that remains. */
  belowTarget: RubricDimResult[];
}

/** Score a passport against the golden-standard rubric for its archetype. */
export function scoreAgainstRubric(p: AppPassport): RubricResult {
  const archetype = p.identity.archetype;
  const dims: RubricDimResult[] = RUBRIC.map((d) => {
    const current = d.pos(p);
    const target = d.target[archetype];
    const progress = target > 0 ? Math.min(1, current / target) : 1;
    return { key: d.key, label: d.label, current, target, weight: d.weight, progress, met: current >= target };
  });
  const totalW = dims.reduce((a, d) => a + d.weight, 0);
  const goldenPct = totalW > 0 ? Math.round((dims.reduce((a, d) => a + d.weight * d.progress, 0) / totalW) * 100) : 100;
  const belowTarget = dims.filter((d) => !d.met).sort((a, b) => a.progress - b.progress);
  return { archetype, goldenPct, dims, belowTarget };
}

// Level-ladder model for the multi-level passport rows. Each ordinal row (a
// scored ladder rather than a yes/no) maps to its full scale + human labels +
// the project's current rung + a one-line "what advances the next level". The
// cell popover renders this so clicking a level explains what the level MEANS
// and how to climb it — instead of a bare dot-bar with no context.
import {
  GRAPH_SCALE, GRAPH_LABEL, CI_SCALE, CI_LABEL, TESTS_SCALE, TESTS_LABEL,
  SECURITY_SCALE, SECURITY_LABEL, OBSERVABILITY_SCALE, OBSERVABILITY_LABEL,
  EVALS_SCALE, EVALS_LABEL, MIGRATIONS_SCALE, MIGRATIONS_LABEL,
  type AppPassport,
} from '../passportModel';

export interface Ladder {
  title: string;
  /** Ordered rung labels, weakest → strongest. */
  steps: string[];
  /** Index of the project's current rung within `steps`. */
  currentIndex: number;
  /** One line: what it takes to climb to the next rung. */
  note: string;
}

interface LadderDef {
  title: string;
  scale: readonly string[];
  label: Record<string, string>;
  current: (p: AppPassport) => string;
  note: string;
}

const LADDERS: Record<string, LadderDef> = {
  context: {
    title: 'Context graph', scale: GRAPH_SCALE, label: GRAPH_LABEL,
    current: (p) => p.automationReadiness.artifacts.contextGraph,
    note: 'Run a context scan to map more of the repo into the graph.',
  },
  ci: {
    title: 'CI', scale: CI_SCALE, label: CI_LABEL,
    current: (p) => p.productionReadiness.ci.level,
    note: 'Gate merges on checks, then enable automerge to reach delivery.',
  },
  tests: {
    title: 'Tests', scale: TESTS_SCALE, label: TESTS_LABEL,
    current: (p) => p.productionReadiness.tests.level,
    note: 'Add a suite covering the critical path, then broaden coverage.',
  },
  security: {
    title: 'Security', scale: SECURITY_SCALE, label: SECURITY_LABEL,
    current: (p) => p.productionReadiness.security.level,
    note: 'Add a policy, then dependency + code scanning, then gate on it.',
  },
  observability: {
    title: 'Observability', scale: OBSERVABILITY_SCALE, label: OBSERVABILITY_LABEL,
    current: (p) => p.productionReadiness.observability.level,
    note: 'Wire error tracking first, then logs, metrics and tracing.',
  },
  evals: {
    title: 'Evals', scale: EVALS_SCALE, label: EVALS_LABEL,
    current: (p) => p.automationReadiness.artifacts.evals,
    note: 'Add an eval harness with real, runnable + scored cases.',
  },
  migrations: {
    title: 'Migrations', scale: MIGRATIONS_SCALE, label: MIGRATIONS_LABEL,
    current: (p) => p.productionReadiness.delivery.migrations,
    note: 'Script schema changes, then version them for repeatable deploys.',
  },
};

/** The ladder for an ordinal row, or null for yes/no / chip rows. */
export function ladderFor(rowKey: string, p: AppPassport): Ladder | null {
  const def = LADDERS[rowKey];
  if (!def) return null;
  return {
    title: def.title,
    steps: def.scale.map((s) => def.label[s] ?? s),
    currentIndex: Math.max(0, def.scale.indexOf(def.current(p))),
    note: def.note,
  };
}

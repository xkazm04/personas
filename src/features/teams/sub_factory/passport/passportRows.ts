// The comparison backbone: passport → sectioned rows of normalized cell values.
// Both matrix variants (Grid + Wall) consume this SAME spec, so every project
// column stays aligned row-for-row and no passport dimension is silently
// dropped. Variants differ only in how a CellValue is PAINTED, never in which
// rows exist or their order.
import {
  CI_LABEL, TESTS_LABEL, SECURITY_LABEL,
  OBSERVABILITY_LABEL, GRAPH_LABEL, EVALS_LABEL, MIGRATIONS_LABEL, INTEGRATION_KIND_LABEL,
  CI_SCALE, TESTS_SCALE, SECURITY_SCALE, OBSERVABILITY_SCALE, GRAPH_SCALE, EVALS_SCALE, MIGRATIONS_SCALE,
  scalePos,
  type AppPassport, type AutomationLevel, type ProdBand,
} from './passportModel';

// -- normalized cell value (the only shape a variant has to render) -----------

export type CellValue =
  /** Automation L-ladder + 0–100 score — a headline. */
  | { kind: 'level'; level: AutomationLevel; score: number }
  /** Production band + 0–100 score — a headline. */
  | { kind: 'band'; band: ProdBand; score: number }
  /** An escalating enum, positioned 0..1 in its scale, with an optional detail. */
  | { kind: 'ordinal'; pos: number; label: string; sub?: string }
  /** A named value where `null` is a MEANINGFUL gap (absent monitoring, etc.). */
  | { kind: 'present'; label: string | null; sub?: string }
  /** A set of named tokens (languages, frameworks, integrations). */
  | { kind: 'chips'; items: string[] }
  /** A set of on/off capabilities rendered as filled/empty pips. */
  | { kind: 'pips'; items: Array<{ label: string; on: boolean }> }
  /** A single yes/no capability. */
  | { kind: 'bool'; on: boolean };

export interface RowSpec {
  key: string;
  label: string;
  /** Headline rows render larger / lead their section. */
  headline?: boolean;
  get: (p: AppPassport) => CellValue;
}
export interface SectionSpec {
  key: string;
  label: string;
  /** lucide icon name resolved by the variant (kept data-only here). */
  icon: 'bot' | 'shield-check' | 'layers' | 'plug';
  rows: RowSpec[];
}

// -- cell builders ------------------------------------------------------------

function testsSub(p: AppPassport): string | undefined {
  const t = p.productionReadiness.tests;
  const bits: string[] = [];
  if (t.frameworks?.length) bits.push(t.frameworks.join(' · '));
  if (t.coveragePct != null) bits.push(`${t.coveragePct}%`);
  return bits.length ? bits.join(' · ') : undefined;
}

function persistenceChips(p: AppPassport): string[] {
  if (p.stack.persistence.length === 0) return [];
  return p.stack.persistence.map((d) => {
    const eng = d.engine ?? d.kind;
    return d.orm ? `${eng} (${d.orm})` : eng;
  });
}

function integrationChips(p: AppPassport): string[] {
  // Concrete vendor names, grouped sentence-style by kind for the chip label.
  return p.stack.integrations.map((i) => `${i.name}`);
}

// -- the sections (order: automation readiness → production → stack → tooling) -

export const SECTIONS: SectionSpec[] = [
  {
    key: 'automation',
    label: 'Readiness for full automation',
    icon: 'bot',
    rows: [
      { key: 'auto', label: 'Automation level', headline: true, get: (p) => ({ kind: 'level', level: p.automationReadiness.level, score: p.automationReadiness.score }) },
      { key: 'selfverify', label: 'Self-verify locally', get: (p) => ({ kind: 'pips', items: [
        { label: 'build', on: p.automationReadiness.selfVerify.build },
        { label: 'test', on: p.automationReadiness.selfVerify.test },
        { label: 'lint', on: p.automationReadiness.selfVerify.lint },
        { label: 'types', on: p.automationReadiness.selfVerify.typecheck },
      ] }) },
      { key: 'context', label: 'Context graph', get: (p) => ({ kind: 'ordinal', pos: scalePos(GRAPH_SCALE, p.automationReadiness.artifacts.contextGraph), label: GRAPH_LABEL[p.automationReadiness.artifacts.contextGraph] }) },
      { key: 'instructions', label: 'Agent instructions', get: (p) => ({ kind: 'chips', items: p.automationReadiness.artifacts.agentInstructions }) },
      { key: 'memory', label: 'Agent memory', get: (p) => ({ kind: 'bool', on: p.automationReadiness.artifacts.memory }) },
      { key: 'skills', label: 'Reusable skills', get: (p) => ({ kind: 'bool', on: p.automationReadiness.artifacts.skills }) },
      { key: 'evals', label: 'Evals', get: (p) => ({ kind: 'ordinal', pos: scalePos(EVALS_SCALE, p.automationReadiness.artifacts.evals), label: EVALS_LABEL[p.automationReadiness.artifacts.evals] }) },
      { key: 'aiflow', label: 'AI in workflow', get: (p) => ({ kind: 'bool', on: p.automationReadiness.aiInWorkflow }) },
    ],
  },
  {
    key: 'production',
    label: 'Production readiness',
    icon: 'shield-check',
    rows: [
      { key: 'band', label: 'Production band', headline: true, get: (p) => ({ kind: 'band', band: p.productionReadiness.band, score: p.productionReadiness.score }) },
      { key: 'ci', label: 'CI', get: (p) => ({ kind: 'ordinal', pos: scalePos(CI_SCALE, p.productionReadiness.ci.level), label: CI_LABEL[p.productionReadiness.ci.level], sub: p.productionReadiness.ci.provider ?? undefined }) },
      { key: 'tests', label: 'Tests', get: (p) => ({ kind: 'ordinal', pos: scalePos(TESTS_SCALE, p.productionReadiness.tests.level), label: TESTS_LABEL[p.productionReadiness.tests.level], sub: testsSub(p) }) },
      { key: 'security', label: 'Security', get: (p) => ({ kind: 'ordinal', pos: scalePos(SECURITY_SCALE, p.productionReadiness.security.level), label: SECURITY_LABEL[p.productionReadiness.security.level], sub: p.productionReadiness.security.tools?.join(' · ') }) },
      { key: 'observability', label: 'Observability', get: (p) => ({ kind: 'ordinal', pos: scalePos(OBSERVABILITY_SCALE, p.productionReadiness.observability.level), label: OBSERVABILITY_LABEL[p.productionReadiness.observability.level] }) },
      { key: 'migrations', label: 'Migrations', get: (p) => ({ kind: 'ordinal', pos: scalePos(MIGRATIONS_SCALE, p.productionReadiness.delivery.migrations), label: MIGRATIONS_LABEL[p.productionReadiness.delivery.migrations] }) },
    ],
  },
  {
    key: 'stack',
    label: 'Stack',
    icon: 'layers',
    rows: [
      { key: 'languages', label: 'Languages', get: (p) => ({ kind: 'chips', items: p.stack.languages.map((l) => l.name) }) },
      { key: 'runtime', label: 'Runtime', get: (p) => ({ kind: 'present', label: p.stack.runtime ?? null }) },
      { key: 'frameworks', label: 'Frameworks', get: (p) => ({ kind: 'chips', items: p.stack.frameworks }) },
      { key: 'persistence', label: 'Persistence', get: (p) => ({ kind: 'chips', items: persistenceChips(p) }) },
      { key: 'hosting', label: 'Hosting', get: (p) => ({ kind: 'present', label: p.stack.hosting ?? null }) },
      { key: 'auth', label: 'Auth', get: (p) => ({ kind: 'present', label: p.stack.auth ?? null }) },
    ],
  },
  {
    key: 'tooling',
    label: 'Tooling & integrations',
    icon: 'plug',
    rows: [
      { key: 'integrations', label: 'Integrations', get: (p) => ({ kind: 'chips', items: integrationChips(p) }) },
      { key: 'errors', label: 'Error tracking', get: (p) => ({ kind: 'present', label: p.stack.monitoring.errorTracking }) },
      { key: 'logs', label: 'Logs', get: (p) => ({ kind: 'present', label: p.stack.monitoring.logs }) },
      { key: 'metrics', label: 'Metrics', get: (p) => ({ kind: 'present', label: p.stack.monitoring.metrics }) },
      { key: 'tracing', label: 'Tracing', get: (p) => ({ kind: 'present', label: p.stack.monitoring.tracing }) },
      { key: 'llmtracking', label: 'LLM tracking', get: (p) => ({ kind: 'present', label: p.stack.llmTracking ?? null }) },
    ],
  },
];

/** Flat list of every row (with its section) — handy for variant A's table body. */
export const ALL_ROWS: Array<{ section: SectionSpec; row: RowSpec }> = SECTIONS.flatMap((section) =>
  section.rows.map((row) => ({ section, row })),
);

// -- sort key for a cell (variant A: click a row label → order columns by it) --

export function cellSortValue(v: CellValue): number {
  switch (v.kind) {
    case 'level': return v.score;
    case 'band': return v.score;
    case 'ordinal': return v.pos * 100;
    case 'present': return v.label ? 60 : 0;
    case 'chips': return v.items.length;
    case 'pips': return v.items.filter((i) => i.on).length;
    case 'bool': return v.on ? 100 : 0;
  }
}

/** The integration-kind tally for a passport — feeds the Wall's "visa" summary. */
export function integrationKindCounts(p: AppPassport): Array<{ label: string; count: number }> {
  const m = new Map<string, number>();
  for (const i of p.stack.integrations) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
  return [...m.entries()].map(([kind, count]) => ({ label: INTEGRATION_KIND_LABEL[kind as keyof typeof INTEGRATION_KIND_LABEL] ?? kind, count }));
}

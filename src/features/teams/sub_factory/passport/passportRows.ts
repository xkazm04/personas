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
  /** An escalating enum, positioned 0..1 in its scale, with an optional detail.
   *  `steps`/`reached` carry the scale geometry (climbable steps above the
   *  floor / steps already climbed) so variants can render a segmented level
   *  bar without re-deriving the scale from the row key. */
  | { kind: 'ordinal'; pos: number; label: string; sub?: string; steps?: number; reached?: number }
  /** A named value where `null` is a MEANINGFUL gap (absent monitoring, etc.). */
  | { kind: 'present'; label: string | null; sub?: string }
  /** A set of named tokens (languages, frameworks, integrations). */
  | { kind: 'chips'; items: string[] }
  /** A set of on/off capabilities rendered as filled/empty pips. */
  | { kind: 'pips'; items: Array<{ label: string; on: boolean }> }
  /** A single yes/no capability. */
  | { kind: 'bool'; on: boolean }
  /** Labeled tallies (e.g. shared vs codebase-specific skills). Zero-total
   *  reads as a setup invitation. */
  | { kind: 'counts'; items: Array<{ label: string; count: number }> };

export interface RowSpec {
  key: string;
  label: string;
  /** One-or-two-line plain-language meaning of the row — shown in the
   *  click-popup on the row label so the wall never needs a manual. */
  info: string;
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

/** Ordinal cell with the scale geometry attached (for segmented level bars). */
function ordinalCell<T extends string>(
  scale: T[],
  value: T,
  label: string,
  sub?: string,
): CellValue {
  const idx = Math.max(0, scale.indexOf(value));
  return { kind: 'ordinal', pos: scalePos(scale, value), label, sub, steps: scale.length - 1, reached: idx };
}

function persistenceChips(p: AppPassport): string[] {
  if (p.stack.persistence.length === 0) return [];
  return p.stack.persistence.map((d) => {
    const eng = d.engine ?? d.kind;
    return d.orm ? `${eng} (${d.orm})` : eng;
  });
}

// -- the sections (order: automation readiness → production → stack → tooling) -

export const SECTIONS: SectionSpec[] = [
  {
    key: 'automation',
    label: 'Readiness for full automation',
    icon: 'bot',
    rows: [
      { key: 'auto', label: 'Automation level', info: 'Headline score (L1–L5): how ready this repo is for coding agents to work in it autonomously.', headline: true, get: (p) => ({ kind: 'level', level: p.automationReadiness.level, score: p.automationReadiness.score }) },
      { key: 'selfverify', label: 'Self-verify locally', info: 'Whether an agent can check its own work without a human — build, test, lint and type-check signals detected in the repo.', get: (p) => ({ kind: 'pips', items: [
        { label: 'build', on: p.automationReadiness.selfVerify.build },
        { label: 'test', on: p.automationReadiness.selfVerify.test },
        { label: 'lint', on: p.automationReadiness.selfVerify.lint },
        { label: 'types', on: p.automationReadiness.selfVerify.typecheck },
      ] }) },
      { key: 'context', label: 'Context coverage', info: 'How much of the codebase is mapped into the contexts agents navigate. Graded from the project context scan — none / partial / full.', get: (p) => (ordinalCell(GRAPH_SCALE, p.automationReadiness.artifacts.contextGraph, GRAPH_LABEL[p.automationReadiness.artifacts.contextGraph])) },
      { key: 'instructions', label: 'Agent instructions', info: 'Guidance coding agents read before touching the repo — a CLAUDE.md file and/or an assigned team policy.', get: (p) => ({ kind: 'chips', items: p.automationReadiness.artifacts.agentInstructions }) },
      { key: 'memory', label: 'Agent memory', info: 'A persistent agent memory store — learnings that survive across sessions instead of being rediscovered every run.', get: (p) => ({ kind: 'bool', on: p.automationReadiness.artifacts.memory }) },
      { key: 'skills', label: 'Reusable skills', info: 'Claude skills in .claude/skills — how many are shared with your library or other projects, and how many are specific to this codebase.', get: (p) => {
        const c = p.automationReadiness.artifacts.skillCounts;
        return c
          ? { kind: 'counts', items: [{ label: 'shared', count: c.reused }, { label: 'specific', count: c.own }] }
          : { kind: 'bool', on: p.automationReadiness.artifacts.skills };
      } },
      { key: 'evals', label: 'Evals', info: 'Runnable, scored evaluation cases that regression-check the product’s core behaviour.', get: (p) => (ordinalCell(EVALS_SCALE, p.automationReadiness.artifacts.evals, EVALS_LABEL[p.automationReadiness.artifacts.evals])) },
      { key: 'aiflow', label: 'AI in workflow', info: 'Whether AI is wired into delivery — auto-PR on green, a team pipeline, or a PR connector.', get: (p) => ({ kind: 'bool', on: p.automationReadiness.aiInWorkflow }) },
    ],
  },
  {
    key: 'production',
    label: 'Production readiness',
    icon: 'shield-check',
    rows: [
      { key: 'band', label: 'Production band', info: 'Headline band (prototype → hardened), scored from CI, security, observability, tests and delivery.', headline: true, get: (p) => ({ kind: 'band', band: p.productionReadiness.band, score: p.productionReadiness.score }) },
      { key: 'ci', label: 'CI', info: 'How merges are protected — from no checks, through pre-commit checks and gated PRs, to automated delivery.', get: (p) => (ordinalCell(CI_SCALE, p.productionReadiness.ci.level, CI_LABEL[p.productionReadiness.ci.level], p.productionReadiness.ci.provider ?? undefined)) },
      { key: 'tests', label: 'Tests', info: 'The automated test suite detected in the repo, graded by how much it covers.', get: (p) => (ordinalCell(TESTS_SCALE, p.productionReadiness.tests.level, TESTS_LABEL[p.productionReadiness.tests.level], testsSub(p))) },
      { key: 'security', label: 'Security', info: 'Security posture — a written policy first, then dependency + code scanning (Dependabot / CodeQL), then CI-gated scans.', get: (p) => (ordinalCell(SECURITY_SCALE, p.productionReadiness.security.level, SECURITY_LABEL[p.productionReadiness.security.level], p.productionReadiness.security.tools?.join(' · '))) },
      { key: 'observability', label: 'Observability', info: 'Whether the running app reports back — error tracking first, then logs, metrics and tracing.', get: (p) => (ordinalCell(OBSERVABILITY_SCALE, p.productionReadiness.observability.level, OBSERVABILITY_LABEL[p.productionReadiness.observability.level])) },
      { key: 'migrations', label: 'Migrations', info: 'How database schema changes ship — ad-hoc, scripted, or versioned and repeatable.', get: (p) => (ordinalCell(MIGRATIONS_SCALE, p.productionReadiness.delivery.migrations, MIGRATIONS_LABEL[p.productionReadiness.delivery.migrations])) },
    ],
  },
  {
    key: 'stack',
    label: 'Stack',
    icon: 'layers',
    rows: [
      { key: 'languages', label: 'Languages', info: 'Programming languages detected in the repo by the cross-project scan.', get: (p) => ({ kind: 'chips', items: p.stack.languages.map((l) => l.name) }) },
      { key: 'runtime', label: 'Runtime', info: 'The runtime the app executes on (node, rust, …), detected from the repo.', get: (p) => ({ kind: 'present', label: p.stack.runtime ?? null }) },
      { key: 'frameworks', label: 'Frameworks', info: 'Application frameworks detected in the repo.', get: (p) => ({ kind: 'chips', items: p.stack.frameworks }) },
      { key: 'persistence', label: 'Persistence', info: 'Databases / storage engines the app persists to, from the scan’s schema signals.', get: (p) => ({ kind: 'chips', items: persistenceChips(p) }) },
      { key: 'hosting', label: 'Hosting', info: 'Where the app runs outside dev — a configured test environment or deploy target.', get: (p) => ({ kind: 'present', label: p.stack.hosting ?? null }) },
      { key: 'auth', label: 'Auth', info: 'The auth method (Clerk / Auth.js / Supabase / …) detected from the repo’s dependencies.', get: (p) => ({ kind: 'present', label: p.stack.auth ?? null }) },
    ],
  },
  {
    key: 'tooling',
    label: 'Tooling & integrations',
    icon: 'plug',
    rows: [
      { key: 'integrations', label: 'Integrations', info: 'External services the app talks to (VCS, payments, LLM APIs, …), detected from config and keywords.', get: (p) => ({ kind: 'chips', items: p.stack.integrations.map((i) => i.name) }) },
      { key: 'errors', label: 'Error tracking', info: 'An error-tracking connector bound to this project — collects crashes and exceptions from the running app.', get: (p) => ({ kind: 'present', label: p.stack.monitoring.errorTracking }) },
      { key: 'logs', label: 'Logs', info: 'Log aggregation, covered by the bound monitoring connector.', get: (p) => ({ kind: 'present', label: p.stack.monitoring.logs }) },
      { key: 'metrics', label: 'Metrics', info: 'Runtime metrics, covered by the bound monitoring connector.', get: (p) => ({ kind: 'present', label: p.stack.monitoring.metrics }) },
      { key: 'tracing', label: 'Tracing', info: 'Distributed tracing, covered by the bound monitoring connector.', get: (p) => ({ kind: 'present', label: p.stack.monitoring.tracing }) },
      { key: 'llmtracking', label: 'LLM tracking', info: 'An LLM-observability connector — tracks this project’s model calls and 30-day spend.', get: (p) => ({ kind: 'present', label: p.stack.llmTracking ?? null }) },
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
    case 'counts': return v.items.reduce((a, i) => a + i.count, 0);
  }
}

/** The integration-kind tally for a passport — feeds the Wall's "visa" summary. */
export function integrationKindCounts(p: AppPassport): Array<{ label: string; count: number }> {
  const m = new Map<string, number>();
  for (const i of p.stack.integrations) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
  return [...m.entries()].map(([kind, count]) => ({ label: INTEGRATION_KIND_LABEL[kind as keyof typeof INTEGRATION_KIND_LABEL] ?? kind, count }));
}

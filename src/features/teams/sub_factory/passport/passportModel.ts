// App Readiness Passport — TypeScript model for the Factory project-comparison
// matrix. Mirrors ascent's `app-passport.schema.json` (the human/portfolio-facing
// SCORECARD that DELIBERATELY names tools, sibling to the agent-facing
// `.ai/manifest.yaml`). Two headline axes — automationReadiness (L1–L5, ready
// for full LLM-automated dev) and productionReadiness (band, ready to trust in
// prod) — plus a tool-naming `stack` block and agent-facing `artifacts`.
//
// Round-1 prototype data lives in `passportMock.ts`; `derivePassport()` bridges
// a live dev_tools project so the same matrix can render real projects once the
// context-scanner emits passports. Nothing here touches the store or IPC.

// -- enums (ordinal, escalating — the sort/heatmap axes) ----------------------

export type AutomationLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type ProdBand = 'prototype' | 'internal' | 'beta' | 'production' | 'hardened';
export type CiLevel = 'none' | 'build' | 'checks' | 'gated' | 'delivery' | 'progressive';
export type TestsLevel = 'none' | 'smoke' | 'partial' | 'substantial' | 'comprehensive';
export type SecurityLevel = 'none' | 'policy' | 'scanning' | 'gated' | 'supply-chain';
export type ObservabilityLevel = 'none' | 'logs' | 'errors' | 'metrics' | 'tracing';
export type GraphLevel = 'none' | 'partial' | 'full';
export type EvalsLevel = 'none' | 'partial' | 'full';
export type MigrationsLevel = 'none' | 'scripted' | 'versioned';
export type IntegrationKind =
  | 'llm' | 'vcs' | 'auth' | 'payments' | 'email' | 'storage'
  | 'queue' | 'analytics' | 'search' | 'comms' | 'ci-cd' | 'infra' | 'other';
export type Archetype = 'solo' | 'team' | 'org';
export type Lifecycle = 'prototype' | 'alpha' | 'beta' | 'ga' | 'maintenance' | 'deprecated';
export type Criticality = 'experimental' | 'internal' | 'business' | 'mission-critical';

// -- object shapes (mirror the schema; readers ignore unknown fields) ---------

export interface PassportIdentity {
  name: string;
  slug: string;
  purpose: string;
  repo?: string;
  owner?: string;
  archetype: Archetype;
  lifecycle: Lifecycle;
  visibility?: 'public' | 'private' | 'internal';
  license?: string | null;
  criticality: Criticality;
}

export interface PassportLanguage { name: string; primary?: boolean }
export interface PassportPersistence {
  kind: 'relational' | 'document' | 'key-value' | 'graph' | 'blob' | 'search' | 'vector' | 'queue' | 'cache' | 'none';
  engine?: string;
  orm?: string | null;
  migrations?: MigrationsLevel;
  required?: boolean;
}
export interface PassportMonitoring {
  errorTracking: string | null;
  logs: string | null;
  metrics: string | null;
  tracing: string | null;
  uptime?: string | null;
}
export interface PassportIntegration {
  name: string;
  kind: IntegrationKind;
  direction?: 'inbound' | 'outbound' | 'bidirectional';
  auth?: string;
}
export interface PassportStack {
  languages: PassportLanguage[];
  runtime?: string;
  frameworks: string[];
  packageManager?: string;
  persistence: PassportPersistence[];
  monitoring: PassportMonitoring;
  /** LLM-observability connector — 'connected' (a credential is bound) or null. */
  llmTracking?: string | null;
  hosting?: string | null;
  /** Auth method (Clerk / Auth.js / Supabase / …) or null. View-only. */
  auth?: string | null;
  integrations: PassportIntegration[];
  secretsFrom?: string;
}

export interface PassportArtifacts {
  agentInstructions: string[];
  contextGraph: GraphLevel;
  memory: boolean;
  manifest: boolean;
  evals: EvalsLevel;
  skills: boolean;
}
export interface PassportSelfVerify {
  build: boolean;
  test: boolean;
  lint: boolean;
  typecheck: boolean;
}
export interface AutomationReadiness {
  level: AutomationLevel;
  score: number;
  artifacts: PassportArtifacts;
  selfVerify: PassportSelfVerify;
  aiInWorkflow: boolean;
  blockers: string[];
}

export interface ProductionReadiness {
  band: ProdBand;
  score: number;
  ci: { level: CiLevel; provider?: string | null; gates?: string[] };
  tests: { level: TestsLevel; coveragePct?: number | null; frameworks?: string[]; criticalPathCovered?: boolean };
  security: { level: SecurityLevel; tools?: string[] };
  observability: { level: ObservabilityLevel };
  delivery: { migrations: MigrationsLevel; iac: boolean; rollback: boolean };
  blockers: string[];
}

export interface AppPassport {
  passport: 'app-passport';
  passportVersion: string;
  generatedAt?: string;
  generatedBy?: string;
  identity: PassportIdentity;
  stack: PassportStack;
  automationReadiness: AutomationReadiness;
  productionReadiness: ProductionReadiness;
  evidence?: { confidence?: number; source?: string; files?: string[] };
}

// -- ordinal scales (index = escalating rank, for sort + heatmap position) -----

export const AUTOMATION_SCALE: AutomationLevel[] = ['L1', 'L2', 'L3', 'L4', 'L5'];
export const PROD_BAND_SCALE: ProdBand[] = ['prototype', 'internal', 'beta', 'production', 'hardened'];
export const CI_SCALE: CiLevel[] = ['none', 'build', 'checks', 'gated', 'delivery', 'progressive'];
export const TESTS_SCALE: TestsLevel[] = ['none', 'smoke', 'partial', 'substantial', 'comprehensive'];
export const SECURITY_SCALE: SecurityLevel[] = ['none', 'policy', 'scanning', 'gated', 'supply-chain'];
export const OBSERVABILITY_SCALE: ObservabilityLevel[] = ['none', 'logs', 'errors', 'metrics', 'tracing'];
export const GRAPH_SCALE: GraphLevel[] = ['none', 'partial', 'full'];
export const EVALS_SCALE: EvalsLevel[] = ['none', 'partial', 'full'];
export const MIGRATIONS_SCALE: MigrationsLevel[] = ['none', 'scripted', 'versioned'];

/** Position of an ordinal value within its scale, as 0..1 (for heatmap tinting). */
export function scalePos<T extends string>(scale: T[], value: T): number {
  const i = scale.indexOf(value);
  return scale.length > 1 ? Math.max(0, i) / (scale.length - 1) : 0;
}

// -- human labels (no raw enum token ever renders — D7 acceptance) -------------

export const AUTOMATION_LABEL: Record<AutomationLevel, string> = {
  L1: 'Manual', L2: 'Assisted', L3: 'Augmented', L4: 'Integrated', L5: 'Autonomous',
};
export const PROD_BAND_LABEL: Record<ProdBand, string> = {
  prototype: 'Prototype', internal: 'Internal', beta: 'Beta', production: 'Production', hardened: 'Hardened',
};
export const CI_LABEL: Record<CiLevel, string> = {
  none: 'None', build: 'Build only', checks: 'Checks (advisory)', gated: 'Gated', delivery: 'Auto-deploy', progressive: 'Progressive',
};
export const TESTS_LABEL: Record<TestsLevel, string> = {
  none: 'None', smoke: 'Smoke', partial: 'Partial', substantial: 'Substantial', comprehensive: 'Comprehensive',
};
export const SECURITY_LABEL: Record<SecurityLevel, string> = {
  none: 'None', policy: 'Policy', scanning: 'Scanning', gated: 'Gated', 'supply-chain': 'Supply-chain',
};
export const OBSERVABILITY_LABEL: Record<ObservabilityLevel, string> = {
  none: 'None', logs: 'Logs', errors: 'Error tracking', metrics: 'Metrics', tracing: 'Tracing',
};
export const GRAPH_LABEL: Record<GraphLevel, string> = { none: 'None', partial: 'Partial', full: 'Full' };
export const EVALS_LABEL: Record<EvalsLevel, string> = { none: 'None', partial: 'Partial', full: 'Full' };
export const MIGRATIONS_LABEL: Record<MigrationsLevel, string> = { none: 'None', scripted: 'Scripted', versioned: 'Versioned' };
export const ARCHETYPE_LABEL: Record<Archetype, string> = { solo: 'Solo', team: 'Team', org: 'Org' };
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  prototype: 'Prototype', alpha: 'Alpha', beta: 'Beta', ga: 'GA', maintenance: 'Maintenance', deprecated: 'Deprecated',
};
export const CRITICALITY_LABEL: Record<Criticality, string> = {
  experimental: 'Experimental', internal: 'Internal', business: 'Business', 'mission-critical': 'Mission-critical',
};
export const INTEGRATION_KIND_LABEL: Record<IntegrationKind, string> = {
  llm: 'LLM', vcs: 'Version control', auth: 'Auth', payments: 'Payments', email: 'Email', storage: 'Storage',
  queue: 'Queue', analytics: 'Analytics', search: 'Search', comms: 'Comms', 'ci-cd': 'CI/CD', infra: 'Infra', other: 'Other',
};

// -- heatmap tint (mirrors the Leaderboard ramp: 80+ emerald / 60+ blue /
//    40+ amber / <40 red) so the two comparison surfaces read identically. ----

export interface Tint { text: string; bg: string; ring: string; hex: string }

export function scoreTint(score: number): Tint {
  if (score >= 80) return { text: 'text-emerald-300', bg: 'bg-emerald-500/12', ring: 'ring-emerald-500/30', hex: '#10b981' };
  if (score >= 60) return { text: 'text-blue-300', bg: 'bg-blue-500/12', ring: 'ring-blue-500/30', hex: '#3b82f6' };
  if (score >= 40) return { text: 'text-amber-300', bg: 'bg-amber-500/12', ring: 'ring-amber-500/30', hex: '#f59e0b' };
  return { text: 'text-red-300', bg: 'bg-red-500/12', ring: 'ring-red-500/30', hex: '#ef4444' };
}

/** Tint for an ordinal value by its position in its scale (0..1 → red→emerald). */
export function ordinalTint(pos: number): Tint {
  return scoreTint(Math.round(pos * 100));
}

/** The "absent / gap" tint — a slate marker for a meaningful null (e.g. no
 *  error tracking). Per the passport spec, null is a first-class answer, not
 *  missing data — so it gets its own visible treatment, not a blank cell. */
export const GAP_TINT: Tint = { text: 'text-slate-400', bg: 'bg-slate-500/10', ring: 'ring-slate-500/20', hex: '#64748b' };

// -- helpers -------------------------------------------------------------------

/** Stable name-ascending sort — the matrix's default column order. */
export function sortByNameAsc(passports: AppPassport[]): AppPassport[] {
  return [...passports].sort((a, b) => a.identity.name.localeCompare(b.identity.name));
}

/**
 * The passport's signature insight: a project whose two readiness axes diverge.
 * `automatable` = well-instrumented for agents but not production-trustworthy
 * (a polished prototype); `prod-trusted` = battle-tested but hostile to agents
 * (no docs/context/fast verify). Returns null when the axes are roughly aligned.
 */
export function readinessSkew(p: AppPassport): { label: string; tone: 'auto' | 'prod' } | null {
  const d = p.automationReadiness.score - p.productionReadiness.score;
  if (d >= 22) return { label: 'Automatable · not prod-ready', tone: 'auto' };
  if (d <= -22) return { label: 'Prod-trusted · low autonomy', tone: 'prod' };
  return null;
}

// R13 — mock payload for the bench's PROJECT-LEVEL TABS, mirroring the real
// Factory L2 structure (Overview | KPIs | Context map | Observability) so
// consolidation/prototype decisions can be made against a FULLY POPULATED
// project. Tiered like everything on the bench: nimbus = rich, atlas = half
// (LLM unwired), comet = bare.

export type MockKpiCategory = 'technical' | 'traffic' | 'value' | 'quality';

export interface MockProposal {
  id: string;
  name: string;
  category: MockKpiCategory;
  baseline: number | null;
  target: number | null;
  unit: string;
  cadence: 'daily' | 'weekly' | 'manual';
  measureKind: 'codebase' | 'connector' | 'manual' | 'derived';
  neededConnector: string | null;
  description: string;
  rationale: string;
  procedure: string;
  direction: 'up' | 'down';
}

export interface MockObsFeature {
  name: string;
  model: string;
  calls: number;
  costUsd: number;
}

export interface MockObsIssue {
  title: string;
  culprit: string | null;
  count: number;
}

const NIMBUS_PROPOSALS: MockProposal[] = [
  {
    id: 'mp1', name: 'Checkout conversion rate', category: 'value',
    baseline: 2.4, target: 5, unit: '%', cadence: 'daily', measureKind: 'connector', neededConnector: null,
    description: 'Completed checkouts over sessions that reached the cart, trailing 7 days.',
    rationale: 'The single number the checkout redesign is accountable to — everything else on the funnel is a proxy.',
    procedure: 'via PostHog funnel checkout_started → order_confirmed', direction: 'up',
  },
  {
    id: 'mp2', name: 'Summary quality rating', category: 'quality',
    baseline: 4.2, target: 4.5, unit: '/5', cadence: 'weekly', measureKind: 'derived', neededConnector: null,
    description: 'Average thumbs rating on AI email summaries, trailing 30 days.',
    rationale: 'The Haiku reroute cut cost 75% — this guards against quality silently paying for it.',
    procedure: 'orchestrator metric: summary_feedback_avg', direction: 'up',
  },
  {
    id: 'mp3', name: 'p95 checkout latency', category: 'technical',
    baseline: 1400, target: 800, unit: 'ms', cadence: 'daily', measureKind: 'connector', neededConnector: null,
    description: 'p95 of the checkout API round-trip as measured at the edge.',
    rationale: 'Conversion drops measurably past the one-second mark; 1.4s is leaving money on the table.',
    procedure: 'via Prometheus histogram checkout_request_duration', direction: 'down',
  },
  {
    id: 'mp4', name: 'Unresolved error events / 14d', category: 'technical',
    baseline: 178, target: 50, unit: '', cadence: 'daily', measureKind: 'connector', neededConnector: null,
    description: 'Sum of event counts across unresolved Sentry issues, trailing 14 days.',
    rationale: 'The payment-step TypeError regressed after the last fix — this keeps the number loud.',
    procedure: 'via Sentry unresolved issue counts', direction: 'down',
  },
  {
    id: 'mp5', name: 'LLM cost per active user', category: 'value',
    baseline: 0.31, target: 0.2, unit: '$', cadence: 'weekly', measureKind: 'derived', neededConnector: null,
    description: '30d LLM spend divided by monthly active users.',
    rationale: 'Cost-to-serve goal is -30%; absolute spend hides growth — per-user is the honest unit.',
    procedure: 'orchestrator metric: llm_cost_30d / mau', direction: 'down',
  },
  {
    id: 'mp6', name: 'Search answer rate', category: 'traffic',
    baseline: null, target: 70, unit: '%', cadence: 'daily', measureKind: 'connector', neededConnector: 'algolia',
    description: 'Queries answered without a follow-up reformulation, trailing 7 days.',
    rationale: 'The "search that answers" goal has no sensor yet — needs the Algolia analytics connector.',
    procedure: 'via Algolia search analytics', direction: 'up',
  },
];

const ATLAS_PROPOSALS: MockProposal[] = [
  {
    id: 'ap1', name: 'Stale pages count', category: 'quality',
    baseline: 132, target: 40, unit: '', cadence: 'weekly', measureKind: 'codebase', neededConnector: null,
    description: 'Docs pages older than 90 days without review, from the versioning index.',
    rationale: 'Staleness is the docs platform’s core failure mode; 132 is a third of the corpus.',
    procedure: 'runs `node scripts/stale-audit.mjs`', direction: 'down',
  },
  {
    id: 'ap2', name: 'AI answer cost / 30d', category: 'value',
    baseline: null, target: 25, unit: '$', cadence: 'daily', measureKind: 'connector', neededConnector: 'tracklight',
    description: '30d LLM spend on the AI search-answers feature.',
    rationale: 'Cost is invisible until a tracer is wired — the KPI exists to force the wiring.',
    procedure: 'via LightTrack pinpoints (use case: ai-search)', direction: 'down',
  },
  {
    id: 'ap3', name: 'Docs search answer rate', category: 'traffic',
    baseline: 41, target: 70, unit: '%', cadence: 'daily', measureKind: 'derived', neededConnector: null,
    description: 'Share of searches resolved without reformulation.',
    rationale: 'The headline goal of the AI search bet.',
    procedure: 'orchestrator metric: search_answered_pct', direction: 'up',
  },
];

export const PROPOSALS_BY_PROJECT: Record<string, MockProposal[]> = {
  'mock-nimbus': NIMBUS_PROPOSALS,
  'mock-atlas': ATLAS_PROPOSALS,
  'mock-comet': [],
};

export const ACTIVE_KPI_COUNT: Record<string, number> = {
  'mock-nimbus': 7, 'mock-atlas': 2, 'mock-comet': 0,
};

// -- observability --------------------------------------------------------------

const NIMBUS_OBS_FEATURES: MockObsFeature[] = [
  { name: 'summarize-email', model: 'claude-haiku-4-5', calls: 18240, costUsd: 30.1 },
  { name: 'checkout-assist', model: 'gpt-4o', calls: 2110, costUsd: 9.8 },
  { name: 'search-rerank', model: 'claude-haiku-4-5', calls: 25400, costUsd: 7.4 },
  { name: 'ticket-triage', model: 'claude-sonnet-4-5', calls: 940, costUsd: 6.2 },
  { name: 'onboarding-hints', model: 'claude-haiku-4-5', calls: 3820, costUsd: 2.1 },
  { name: '(untagged · claude-sonnet-4-5)', model: 'claude-sonnet-4-5', calls: 130, costUsd: 1.4 },
];

const NIMBUS_OBS_ISSUES: MockObsIssue[] = [
  { title: 'TypeError: cannot read amount of undefined', culprit: 'src/checkout/payment/PaymentStep.tsx', count: 178 },
  { title: 'Stripe webhook signature mismatch', culprit: 'api/webhooks/stripe in verifySignature', count: 41 },
  { title: 'Unhandled rejection: quota exceeded', culprit: 'src/email/ingest/QuotaGuard.ts', count: 26 },
  { title: 'Hydration mismatch on /pricing', culprit: 'src/marketing/PricingTable.tsx', count: 12 },
  { title: 'AbortError: signal is aborted', culprit: 'src/search/useSearch.ts', count: 7 },
];

const ATLAS_OBS_ISSUES: MockObsIssue[] = [
  { title: 'undefined reader in search index', culprit: 'src/search/indexReader.ts', count: 3 },
  { title: 'ENOENT on versioned asset', culprit: 'src/publish/assetPipeline.ts', count: 2 },
];

export const OBS_BY_PROJECT: Record<string, { features: MockObsFeature[] | null; issues: MockObsIssue[] | null }> = {
  // null = that sensor is unwired for the tier → the tab renders the blue ask.
  'mock-nimbus': { features: NIMBUS_OBS_FEATURES, issues: NIMBUS_OBS_ISSUES },
  'mock-atlas': { features: null, issues: ATLAS_OBS_ISSUES },
  'mock-comet': { features: null, issues: null },
};

// -- context-map extras (per-context coverage, seeded + deterministic) -----------

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mockFeatureCount(cellId: string): number {
  return hash(cellId) % 4;
}

export function mockGoalCount(cellId: string): number {
  return hash(`${cellId}#g`) % 3;
}

/** The proposed KPIs attached to one context — a deterministic slice of the
 *  project's proposal pool (R14 consolidation: the KPIs tab folds into the
 *  context card's indicator + tooltip). ~40% of contexts carry 1–2. */
export function mockProposalsForCell(cellId: string, projectId: string): MockProposal[] {
  const pool = PROPOSALS_BY_PROJECT[projectId] ?? [];
  if (pool.length === 0) return [];
  const h = hash(`${cellId}#k`);
  const count = h % 5 >= 3 ? (h % 2) + 1 : 0; // 0,0,0,1|2 pattern
  if (count === 0) return [];
  const start = h % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]!);
}

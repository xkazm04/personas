// Mock data for the Project Cockpit prototype (R1 of the Dev Tools CX redesign —
// docs/plans/dev-tools-cx-redesign.md §3).
//
// NO real data touches this prototype: three hand-written projects at the three
// WIRING TIERS the design must survive —
//   • bare       — nothing wired  → the cockpit must become an establishment
//                  checklist, never a broken dashboard
//   • half-wired — some sensors   → real numbers where possible, wiring CTAs
//                  everywhere else ("absence encourages wiring")
//   • full       — everything     → the full dimensional cockpit incl. verdicts
//
// The hard rule the mocks exist to test: MEASUREMENT BEFORE OPINION. A KPI whose
// sensor isn't wired carries `needsWiring`, and the UI must render a wire-me CTA
// in that slot — never a fake number, never an empty chart.
import type { VerifyState } from '@/api/devTools/devTools';

// -- wiring -------------------------------------------------------------------

export type WiringKey = 'repo' | 'monitoring' | 'llm' | 'database' | 'auth';

export interface MockWiring {
  key: WiringKey;
  label: string;
  /** What wiring it unlocks — the establishment checklist's pitch line. */
  unlocks: string;
  wired: boolean;
}

// -- measurements ---------------------------------------------------------------

export type KpiKind = 'metric' | 'rating';

export interface MockKpi {
  id: string;
  name: string;
  unit: string;
  kind: KpiKind;
  /** null = unmeasured. If `needsWiring` is set, unmeasured BECAUSE unwired. */
  current: number | null;
  target: number;
  direction: 'up' | 'down';
  /** % change over the window; null = no history yet. */
  trendPct: number | null;
  /** The sensor this measurement depends on, when it isn't wired. */
  needsWiring?: WiringKey;
}

export interface MockFinding {
  id: string;
  title: string;
  /** Matches the real FindingOrigin vocabulary so badges reuse originMeta(). */
  origin: 'standards_finding' | 'passport_gap' | 'llm_cost' | 'sentry_spike' | 'kpi_offtrack';
  state: 'proposed' | 'dispatched' | 'verified';
  verdict: VerifyState | null;
  /** The receipt — rendered inline; measurement before opinion. */
  evidence: string;
}

export interface MockFeature {
  id: string;
  name: string;
  kpis: MockKpi[];
  /** 30d LLM spend flowing through this feature; null when the tracer is unwired. */
  costUsd: number | null;
  /** 0–5 user rating; null = no feedback signal yet. */
  rating: number | null;
  findings: MockFinding[];
  goalId: string | null;
}

export interface MockGoal {
  id: string;
  name: string;
  progressPct: number;
}

export interface MockLoopWeek {
  raised: number;
  dispatched: number;
  cleared: number;
  moved: number;
  unchanged: number;
  regressed: number;
}

export interface MockProject {
  id: string;
  name: string;
  purpose: string;
  tier: 'bare' | 'half' | 'full';
  /** Passport seals. */
  automation: { level: string; score: number };
  production: { band: string; score: number };
  wiring: MockWiring[];
  goals: MockGoal[];
  /** Business dimension — features (context-map use cases) as measurable units. */
  features: MockFeature[];
  /** Technical dimension — platform KPIs + readiness/ops findings. */
  technicalKpis: MockKpi[];
  technicalFindings: MockFinding[];
  loopWeek: MockLoopWeek | null;
}

// -- helpers ------------------------------------------------------------------

const w = (key: WiringKey, label: string, unlocks: string, wired: boolean): MockWiring => ({
  key, label, unlocks, wired,
});

/** Off-target when a `down` KPI sits above target or an `up` KPI below it. */
export function kpiTone(k: MockKpi): 'success' | 'warning' | 'error' | 'neutral' {
  if (k.current === null) return 'neutral';
  const good = k.direction === 'down' ? k.current <= k.target : k.current >= k.target;
  if (good) return 'success';
  const off = Math.abs(k.current - k.target) / Math.max(1e-9, Math.abs(k.target));
  return off > 0.5 ? 'error' : 'warning';
}

// -- the three projects ---------------------------------------------------------

/** FULL — everything wired; the loop has history, including one loud regression. */
const nimbus: MockProject = {
  id: 'mock-nimbus',
  name: 'Nimbus CRM',
  purpose: 'Customer relationship suite — the flagship, fully instrumented.',
  tier: 'full',
  automation: { level: 'L4', score: 78 },
  production: { band: 'production', score: 82 },
  wiring: [
    w('repo', 'Source control', 'PRs, commits, the PR Bridge', true),
    w('monitoring', 'Monitoring (Sentry)', 'errors per context, spike findings', true),
    w('llm', 'LLM tracking (LightTrack)', 'cost per feature, cost findings', true),
    w('database', 'Database', 'migrations readiness', true),
    w('auth', 'Auth', 'production-readiness band', true),
  ],
  goals: [
    { id: 'g1', name: 'Cut cost-to-serve 30%', progressPct: 55 },
    { id: 'g2', name: 'Checkout conversion to 5%', progressPct: 40 },
    { id: 'g3', name: 'Platform health', progressPct: 70 },
  ],
  features: [
    {
      id: 'f1',
      name: 'Summarize email',
      goalId: 'g1',
      costUsd: 30,
      rating: 4.2,
      kpis: [
        { id: 'k1', name: 'Cost / 30d', unit: '$', kind: 'metric', current: 30, target: 40, direction: 'down', trendPct: -75 },
        { id: 'k2', name: 'Summary quality', unit: '/5', kind: 'rating', current: 4.2, target: 4.0, direction: 'up', trendPct: 3 },
      ],
      findings: [
        {
          id: 'fd1', title: 'Route summarize-email to Haiku', origin: 'llm_cost',
          state: 'verified', verdict: 'moved',
          evidence: '$120 → $30 /30d after reroute (threshold $5)',
        },
      ],
    },
    {
      id: 'f2',
      name: 'Checkout conversion',
      goalId: 'g2',
      costUsd: 12,
      rating: 3.1,
      kpis: [
        { id: 'k3', name: 'Conversion', unit: '%', kind: 'metric', current: 2.4, target: 5, direction: 'up', trendPct: -8 },
        { id: 'k4', name: 'p95 checkout', unit: 'ms', kind: 'metric', current: 1400, target: 800, direction: 'down', trendPct: 12 },
      ],
      findings: [
        {
          id: 'fd2', title: 'Fix TypeError in payment step', origin: 'sentry_spike',
          state: 'verified', verdict: 'regressed',
          evidence: 'events 120 → 178 /14d after the fix shipped',
        },
        {
          id: 'fd3', title: 'Trim checkout context payload', origin: 'llm_cost',
          state: 'dispatched', verdict: null,
          evidence: '$9.80 /30d on gpt-4o (threshold $5)',
        },
      ],
    },
    {
      id: 'f3',
      name: 'Onboarding wizard',
      goalId: 'g2',
      costUsd: 4,
      rating: 4.6,
      kpis: [
        { id: 'k5', name: 'Completion', unit: '%', kind: 'metric', current: 68, target: 60, direction: 'up', trendPct: 6 },
      ],
      findings: [],
    },
  ],
  technicalKpis: [
    { id: 't1', name: 'Unresolved errors', unit: '', kind: 'metric', current: 7, target: 5, direction: 'down', trendPct: -30 },
    { id: 't2', name: 'Events / 24h', unit: '', kind: 'metric', current: 210, target: 300, direction: 'down', trendPct: -5 },
    { id: 't3', name: 'LLM spend / 30d', unit: '$', kind: 'metric', current: 46, target: 80, direction: 'down', trendPct: -52 },
    { id: 't4', name: 'Test coverage', unit: '%', kind: 'metric', current: 61, target: 70, direction: 'up', trendPct: 2 },
  ],
  technicalFindings: [
    {
      id: 'fd4', title: 'Raise Tests to the golden standard', origin: 'passport_gap',
      state: 'verified', verdict: 'unchanged',
      evidence: 'tests dimension still `partial` after task completed (+4.2% golden if closed)',
    },
    {
      id: 'fd5', title: 'CI lacks a gated pipeline', origin: 'standards_finding',
      state: 'proposed', verdict: null,
      evidence: 'rule ci.gated = missing (severity warn)',
    },
  ],
  loopWeek: { raised: 4, dispatched: 2, cleared: 1, moved: 1, unchanged: 1, regressed: 1 },
};

/** HALF — monitoring wired, LLM tracking + auth missing → CTAs in those slots. */
const atlas: MockProject = {
  id: 'mock-atlas',
  name: 'Atlas Docs',
  purpose: 'Documentation platform — instrumented halfway; the CTAs must earn the rest.',
  tier: 'half',
  automation: { level: 'L3', score: 58 },
  production: { band: 'beta', score: 49 },
  wiring: [
    w('repo', 'Source control', 'PRs, commits, the PR Bridge', true),
    w('monitoring', 'Monitoring (Sentry)', 'errors per context, spike findings', true),
    w('llm', 'LLM tracking', 'cost per feature, cost findings', false),
    w('database', 'Database', 'migrations readiness', true),
    w('auth', 'Auth', 'production-readiness band', false),
  ],
  goals: [
    { id: 'g4', name: 'Search that answers', progressPct: 30 },
    { id: 'g5', name: 'Platform health', progressPct: 45 },
  ],
  features: [
    {
      id: 'f4',
      name: 'AI search answers',
      goalId: 'g4',
      costUsd: null, // tracer unwired — the slot must sell the wiring, not fake a number
      rating: 3.8,
      kpis: [
        { id: 'k6', name: 'Answer rate', unit: '%', kind: 'metric', current: 41, target: 70, direction: 'up', trendPct: 9 },
        { id: 'k7', name: 'Cost / 30d', unit: '$', kind: 'metric', current: null, target: 25, direction: 'down', trendPct: null, needsWiring: 'llm' },
      ],
      findings: [
        {
          id: 'fd6', title: 'Fix undefined reader in search index', origin: 'sentry_spike',
          state: 'verified', verdict: 'cleared',
          evidence: 'ATLAS-3 resolved; events 96 → 0 /14d',
        },
      ],
    },
    {
      id: 'f5',
      name: 'Doc versioning',
      goalId: null,
      costUsd: null,
      rating: null, // no feedback signal yet either
      kpis: [
        { id: 'k8', name: 'Stale pages', unit: '', kind: 'metric', current: 132, target: 40, direction: 'down', trendPct: 0 },
      ],
      findings: [],
    },
  ],
  technicalKpis: [
    { id: 't5', name: 'Unresolved errors', unit: '', kind: 'metric', current: 12, target: 5, direction: 'down', trendPct: 20 },
    { id: 't6', name: 'LLM spend / 30d', unit: '$', kind: 'metric', current: null, target: 40, direction: 'down', trendPct: null, needsWiring: 'llm' },
    { id: 't7', name: 'Test coverage', unit: '%', kind: 'metric', current: 34, target: 70, direction: 'up', trendPct: 0 },
  ],
  technicalFindings: [
    {
      id: 'fd7', title: 'Instrument LLM call sites', origin: 'llm_cost',
      state: 'proposed', verdict: null,
      evidence: 'no tracer wired — cost is invisible to every dimension',
    },
  ],
  loopWeek: { raised: 2, dispatched: 1, cleared: 1, moved: 0, unchanged: 0, regressed: 0 },
};

/** BARE — nothing wired. The cockpit must become an establishment journey. */
const comet: MockProject = {
  id: 'mock-comet',
  name: 'Comet Landing',
  purpose: 'Fresh marketing site — registered five minutes ago; nothing wired yet.',
  tier: 'bare',
  automation: { level: 'L1', score: 12 },
  production: { band: 'prototype', score: 8 },
  wiring: [
    w('repo', 'Source control', 'PRs, commits, the PR Bridge', false),
    w('monitoring', 'Monitoring (Sentry)', 'errors per context, spike findings', false),
    w('llm', 'LLM tracking', 'cost per feature, cost findings', false),
    w('database', 'Database', 'migrations readiness', false),
    w('auth', 'Auth', 'production-readiness band', false),
  ],
  goals: [],
  features: [],
  technicalKpis: [],
  technicalFindings: [],
  loopWeek: null,
};

export const MOCK_PROJECTS: MockProject[] = [nimbus, atlas, comet];

// ============================================================================
// R3 — the first-layer HEALTH GRID (50–100 contexts per solid project).
//
// Text cannot carry this density; colour + symbolics must. Each context cell
// holds FOUR dimension states (errors · cost · kpi · loop) so variants can
// compose them differently: dominant-signal cells (Floorplan) or per-dimension
// quadrants (Spectrum). Deterministic seeded generation — stable renders, no
// Math.random.
// ============================================================================

export type CellTone = 'crit' | 'warn' | 'ok' | 'unmeasured';
export type LoopMark = 'regressed' | 'moved' | 'inflight' | 'proposed' | null;

export interface MockContextCell {
  id: string;
  name: string;
  dims: { errors: CellTone; cost: CellTone; kpi: CellTone; loop: CellTone };
  /** The loop artifact on this context, if any (drawn as the cell's glyph). */
  mark: LoopMark;
}

export interface MockContextGroup {
  id: string;
  name: string;
  cells: MockContextCell[];
}

/** Worst-wins dominant tone across measured dimensions. */
export function dominantTone(c: MockContextCell): CellTone {
  const d = Object.values(c.dims);
  if (d.every((t) => t === 'unmeasured')) return 'unmeasured';
  if (d.includes('crit')) return 'crit';
  if (d.includes('warn')) return 'warn';
  return 'ok';
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rnd = (seed: string) => (hash(seed) % 1000) / 1000;

const TOPICS = ['ingest', 'render', 'cache', 'sync', 'routing', 'schema', 'webhooks', 'sessions', 'billing', 'export', 'search', 'notify', 'audit', 'quota', 'themes', 'uploads'];

interface GridProfile {
  /** [pCrit, pWarn] per measured dimension. */
  errors: [number, number]; cost: [number, number]; kpi: [number, number];
  /** Dimensions that are entirely UNWIRED for this project (dark everywhere). */
  unwired: ('errors' | 'cost')[];
}

function tone(seed: string, p: [number, number], unwired: boolean): CellTone {
  if (unwired) return 'unmeasured';
  const r = rnd(seed);
  if (r < p[0]) return 'crit';
  if (r < p[0] + p[1]) return 'warn';
  if (r > 0.96) return 'unmeasured'; // the odd context nothing measures yet
  return 'ok';
}

function genGrid(
  projectSeed: string,
  groups: { name: string; size: number }[],
  profile: GridProfile,
  marks: { group: number; cell: number; mark: Exclude<LoopMark, null>; crit?: boolean }[],
): MockContextGroup[] {
  return groups.map((g, gi) => ({
    id: `${projectSeed}-g${gi}`,
    name: g.name,
    cells: Array.from({ length: g.size }, (_, ci) => {
      const seed = `${projectSeed}/${gi}/${ci}`;
      const cell: MockContextCell = {
        id: `${seed}`,
        name: `${g.name} · ${TOPICS[hash(seed) % TOPICS.length]}`,
        dims: {
          errors: tone(`${seed}e`, profile.errors, profile.unwired.includes('errors')),
          cost: tone(`${seed}c`, profile.cost, profile.unwired.includes('cost')),
          kpi: tone(`${seed}k`, profile.kpi, false),
          loop: 'ok',
        },
        mark: null,
      };
      const m = marks.find((x) => x.group === gi && x.cell === ci);
      if (m) {
        cell.mark = m.mark;
        cell.dims.loop = m.mark === 'regressed' ? 'crit' : m.mark === 'moved' ? 'ok' : 'warn';
        if (m.crit) cell.dims.errors = 'crit';
      }
      return cell;
    }),
  }));
}

/** FULL — 72 contexts / 8 groups; one loud regression, a moved win, work in flight. */
export const GRID_FULL: MockContextGroup[] = genGrid(
  'nimbus',
  [
    { name: 'Auth & Identity', size: 9 }, { name: 'Checkout', size: 11 },
    { name: 'Email intelligence', size: 8 }, { name: 'Search', size: 10 },
    { name: 'Data platform', size: 12 }, { name: 'Notifications', size: 7 },
    { name: 'Admin console', size: 9 }, { name: 'Integrations', size: 6 },
  ],
  { errors: [0.05, 0.13], cost: [0.04, 0.1], kpi: [0.06, 0.16], unwired: [] },
  [
    { group: 1, cell: 3, mark: 'regressed', crit: true }, // the one you cannot miss
    { group: 2, cell: 1, mark: 'moved' },                 // the $120→$30 win
    { group: 1, cell: 7, mark: 'inflight' },
    { group: 4, cell: 5, mark: 'inflight' },
    { group: 3, cell: 2, mark: 'proposed' },
    { group: 6, cell: 4, mark: 'proposed' },
    { group: 0, cell: 6, mark: 'proposed' },
  ],
);

/** HALF — 48 contexts / 6 groups; monitoring + LLM tracking UNWIRED, so the
 *  errors and cost dimensions are dark EVERYWHERE — the wiring argument, visual. */
export const GRID_HALF: MockContextGroup[] = genGrid(
  'atlas',
  [
    { name: 'Docs engine', size: 10 }, { name: 'AI search', size: 9 },
    { name: 'Versioning', size: 8 }, { name: 'Publishing', size: 8 },
    { name: 'Accounts', size: 7 }, { name: 'Theming', size: 6 },
  ],
  { errors: [0, 0], cost: [0, 0], kpi: [0.05, 0.2], unwired: ['errors', 'cost'] },
  [
    { group: 1, cell: 2, mark: 'moved' },
    { group: 0, cell: 5, mark: 'proposed' },
  ],
);

export function gridFor(project: MockProject): MockContextGroup[] {
  if (project.tier === 'full') return GRID_FULL;
  if (project.tier === 'half') return GRID_HALF;
  return [];
}

/** Global first-sight summary across a grid. */
export function gridSummary(groups: MockContextGroup[]) {
  const s = { crit: 0, warn: 0, ok: 0, unmeasured: 0, total: 0 };
  for (const g of groups) for (const c of g.cells) { s[dominantTone(c)] += 1; s.total += 1; }
  return s;
}

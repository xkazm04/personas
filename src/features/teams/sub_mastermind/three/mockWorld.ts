// Mock world for the 3D Mastermind prototypes — TEN projects, so the
// portfolio layer is evaluated at the size a real workspace actually reaches
// rather than at the two-project size that flatters every layout.
//
// The two reference projects (a healthy one that is shipping, a warning one
// with a real gap) stay hand-authored cell by cell: they are what the L1 and
// L2 layers are read against. The other eight are SKETCHED — a maturity
// profile plus named exceptions, expanded deterministically into the same
// fifteen dimensions. That is deliberate: 150 hand-written cells would be a
// wall of numbers nobody could keep coherent, and what L0 is being judged on
// is whether ten projects stay legible and distinguishable, which needs
// variety and plausibility rather than authored detail.
//
// Dimension keys, labels, categories and icons come from the real registry so
// the mock never invents a dimension the product does not have.
import { DIM_ORDER, DIM_REGISTRY, type DimCategory, type DimKey } from '../lib/dimRegistry';
import { formatNumeric } from '@/lib/utils/formatters';

import { hash01 } from '../lib/hex';
import type { DimStatus, IslandState } from '../lib/types';

export interface WorldDim {
  key: DimKey;
  status: DimStatus;
  /** Ordinal progress within the dimension's scale (0/0 = boolean). */
  reached: number;
  steps: number;
  /** Concrete tool naming, the way the passport does it. */
  detail: string | null;
  /** One headline number for the L2 focus card (already formatted). */
  figure: string | null;
}

export interface WorldFleet {
  id: string;
  name: string;
  state: 'running' | 'awaiting_input' | 'idle' | 'stale';
}

export interface WorldShip {
  next: string | null;
  shipped: number;
  total: number;
  targetDate: string | null;
  late: boolean;
}

export interface WorldProject {
  slug: string;
  name: string;
  /** Short mono tag the HUD and the world both paint (e.g. `PRS-01`). */
  tag: string;
  purpose: string;
  state: IslandState;
  autoScore: number;
  prodScore: number;
  lifecycle: string;
  blockers: number;
  dims: WorldDim[];
  fleet: WorldFleet[];
  personasRunning: string[];
  ship: WorldShip;
  /** 30-day LLM spend in USD (raw number — formatted at render time). */
  llmSpend30d: number;
  /** Live monitoring error count (null = no monitoring bound). */
  monitorErrors: number | null;
}

export interface WorldEdge {
  from: string;
  to: string;
  kind: 'relation' | 'similarity';
  strength: number;
  label: string;
}

export interface World {
  projects: WorldProject[];
  edges: WorldEdge[];
}

const dim = (key: DimKey, status: DimStatus, reached: number, steps: number, detail: string | null, figure: string | null = null): WorldDim =>
  ({ key, status, reached, steps, detail, figure });

// ── The two hand-authored reference projects ─────────────────────────────────

const PERSONAS: WorldProject = {
  slug: 'personas',
  name: 'Personas Desktop',
  tag: 'PRS-01',
  purpose: 'Build, orchestrate and monitor AI agent personas — local-first desktop app.',
  state: 'healthy',
  autoScore: 86,
  prodScore: 79,
  lifecycle: 'scaling',
  blockers: 0,
  dims: [
    dim('db', 'solid', 2, 2, 'SQLite + AES-256-GCM vault', '41 tables'),
    dim('monitoring', 'solid', 3, 3, 'Sentry (desktop DSN)', '0 open issues'),
    dim('ci', 'solid', 3, 3, 'GitHub Actions — 17 gates', '17/17 green'),
    dim('tests', 'partial', 2, 3, 'Vitest 2,400 + cargo test', '71% coverage'),
    dim('security', 'solid', 3, 3, 'Whole-app review 2026-08', '8 fixed'),
    dim('hosting', 'solid', 1, 1, 'Tauri installers (nsis + msi)', 'v1.14'),
    dim('auth', 'solid', 0, 0, 'Claude OAuth + vault', null),
    dim('agents', 'solid', 3, 3, 'Athena companion + fleet', '12 personas'),
    dim('skills', 'solid', 2, 2, '36 skills linked from registry', '36'),
    dim('llm', 'partial', 1, 2, 'Per-capability tiers stamped', '$212 / 30d'),
    dim('kpi', 'partial', 2, 3, '14 active, 2 off-track', '14 KPIs'),
    dim('ideas', 'solid', 1, 1, 'Scanned 2 days ago', '2d'),
    dim('goals', 'solid', 1, 1, '5 ongoing goals', '5'),
    dim('datalinks', 'absent', 0, 1, null, null),
    dim('support', 'partial', 1, 2, 'Telegram channel', '1 channel'),
  ],
  fleet: [
    { id: 'f-prs-1', name: 'otter', state: 'running' },
    { id: 'f-prs-2', name: 'heron', state: 'awaiting_input' },
    { id: 'f-prs-3', name: 'lynx', state: 'idle' },
  ],
  personasRunning: ['Athena', 'Reviewer'],
  ship: { next: 'Mastermind 3D', shipped: 7, total: 9, targetDate: '2026-09-30', late: false },
  llmSpend30d: 212,
  monitorErrors: 0,
};

const BRAINIAC: WorldProject = {
  slug: 'brainiac',
  name: 'Brainiac',
  tag: 'BRN-02',
  purpose: 'Organisation memory service — hybrid retrieval, RLS store, MCP surface.',
  state: 'warning',
  autoScore: 58,
  prodScore: 44,
  lifecycle: 'building',
  blockers: 2,
  dims: [
    dim('db', 'solid', 2, 2, 'Postgres 16 + pgvector (RLS)', '9 tables'),
    dim('monitoring', 'absent', 0, 3, null, null),
    dim('ci', 'partial', 1, 3, 'cargo test on push, no deploy job', '1/3'),
    dim('tests', 'risk', 1, 3, '7 crates, 2 without tests', '38% coverage'),
    dim('security', 'alert', 0, 3, 'RLS bypass on service role', '1 critical'),
    dim('hosting', 'partial', 1, 2, 'Alibaba ECS free tier', 'trial'),
    dim('auth', 'partial', 0, 0, 'API key only', null),
    dim('agents', 'partial', 1, 3, 'MCP server, no agent loop', '1 tool'),
    dim('skills', 'absent', 0, 2, null, null),
    dim('llm', 'solid', 2, 2, 'DashScope + Anthropic, stamped', '$38 / 30d'),
    dim('kpi', 'absent', 0, 3, null, null),
    dim('ideas', 'risk', 0, 1, 'Never scanned', 'never'),
    dim('goals', 'solid', 1, 1, '2 ongoing goals', '2'),
    dim('datalinks', 'solid', 1, 1, 'Dune dashboard', '1 link'),
    dim('support', 'absent', 0, 2, null, null),
  ],
  fleet: [
    { id: 'f-brn-1', name: 'falcon', state: 'stale' },
  ],
  personasRunning: [],
  ship: { next: 'Console v1', shipped: 3, total: 6, targetDate: '2026-09-18', late: true },
  llmSpend30d: 38,
  monitorErrors: null,
};

// ── Sketched projects ────────────────────────────────────────────────────────

/** Per-dimension scale length + the tool vocabulary a sketch draws from. */
const DIM_SHAPE: Record<DimKey, { steps: number; tools: string[]; figure?: (score: number, seed: number) => string }> = {
  db: { steps: 2, tools: ['Postgres 16', 'SQLite (WAL)', 'Supabase', 'Turso'], figure: (_s, h) => `${4 + Math.round(h * 30)} tables` },
  monitoring: { steps: 3, tools: ['Sentry', 'Grafana Cloud', 'Axiom', 'Better Stack'], figure: (s, h) => `${s > 0.75 ? Math.round(h * 3) : Math.round(h * 40)} open issues` },
  ci: { steps: 3, tools: ['GitHub Actions', 'GitLab CI', 'Actions + Renovate'], figure: (s) => `${Math.round(s * 12)}/12 green` },
  tests: { steps: 3, tools: ['Vitest', 'Vitest + Playwright', 'cargo test', 'pytest'], figure: (s) => `${Math.round(20 + s * 65)}% coverage` },
  security: { steps: 3, tools: ['Dependabot + review', 'gitleaks + audit', 'Snyk'], figure: (s, h) => `${s > 0.7 ? 0 : 1 + Math.round(h * 3)} open` },
  hosting: { steps: 2, tools: ['Vercel', 'Fly.io', 'Alibaba ECS', 'AWS ECS', 'Cloudflare'], figure: (_s, h) => `v0.${1 + Math.round(h * 8)}` },
  auth: { steps: 0, tools: ['Clerk', 'Supabase Auth', 'OAuth (GitHub)', 'API key only'] },
  agents: { steps: 3, tools: ['Claude Code fleet', 'MCP server', 'single agent loop'], figure: (_s, h) => `${1 + Math.round(h * 9)} personas` },
  skills: { steps: 2, tools: ['registry-linked skills', 'project skills'], figure: (_s, h) => `${2 + Math.round(h * 20)}` },
  // Cost goes through the shared formatter rather than a hand-written `$` +
  // interpolation: the rounding and the currency glyph are one contract and
  // it does not belong at each fixture line (census: hand-assembled-currency).
  llm: { steps: 2, tools: ['Anthropic, stamped', 'Anthropic + OpenAI', 'DashScope'], figure: (_s, h) => `${formatNumeric(4 + Math.round(h * 90), 'usd')} / 30d` },
  kpi: { steps: 3, tools: ['Factory KPIs'], figure: (_s, h) => `${2 + Math.round(h * 14)} KPIs` },
  ideas: { steps: 1, tools: ['Idea scan'], figure: (s, h) => (s > 0.6 ? `${1 + Math.round(h * 9)}d` : 'never') },
  goals: { steps: 1, tools: ['Dev goals'], figure: (_s, h) => `${1 + Math.round(h * 6)}` },
  datalinks: { steps: 1, tools: ['Dune dashboard', 'Metabase', 'BigQuery export'] },
  support: { steps: 2, tools: ['Telegram channel', 'Discord', 'Intercom'], figure: (_s, h) => `${1 + Math.round(h * 2)} channels` },
};

/** Dimensions the sketcher biases up or down for everyone — the shape of the
 *  operator's own portfolio: runtime gets wired early, product gets wired last. */
const DIM_BIAS: Partial<Record<DimKey, number>> = {
  db: 0.22, hosting: 0.16, auth: 0.1, llm: 0.12,
  ci: 0.04, tests: -0.06, security: -0.1,
  agents: 0.02, skills: -0.12,
  kpi: -0.22, ideas: -0.12, goals: -0.04, datalinks: -0.3, support: -0.26,
};

interface Sketch {
  slug: string;
  name: string;
  tag: string;
  purpose: string;
  state: IslandState;
  lifecycle: string;
  /** 0..1 — how far along the whole project is. Drives every derived cell. */
  maturity: number;
  /** Named exceptions, because a real portfolio is never uniform. */
  broken?: DimKey[];
  weak?: DimKey[];
  missing?: DimKey[];
  strong?: DimKey[];
  fleet?: WorldFleet[];
  personasRunning?: string[];
  ship: WorldShip;
  llmSpend30d: number;
  monitorErrors: number | null;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function sketchDims(s: Sketch): WorldDim[] {
  const broken = new Set(s.broken ?? []);
  const weak = new Set(s.weak ?? []);
  const missing = new Set(s.missing ?? []);
  const strong = new Set(s.strong ?? []);
  return DIM_ORDER.map((key) => {
    const shape = DIM_SHAPE[key];
    const h = hash01(`${s.slug}:${key}`);
    let score = clamp01(s.maturity + (DIM_BIAS[key] ?? 0) + (h - 0.5) * 0.34);
    if (strong.has(key)) score = clamp01(score + 0.45);

    let status: DimStatus;
    if (broken.has(key)) status = 'alert';
    else if (weak.has(key)) status = 'risk';
    else if (missing.has(key)) status = 'absent';
    else if (score >= 0.74) status = 'solid';
    else if (score >= 0.44) status = 'partial';
    else if (score >= 0.26) status = 'partial';
    else status = 'absent';

    const steps = shape.steps;
    const reached = status === 'solid' ? steps
      : status === 'absent' ? 0
      : Math.max(steps > 0 ? 1 : 0, Math.min(steps - 1, Math.round(score * steps)));
    const detail = status === 'absent' ? null : shape.tools[Math.floor(h * shape.tools.length) % shape.tools.length] ?? null;
    const figure = status === 'absent' ? null : shape.figure?.(score, hash01(`${s.slug}:${key}:fig`)) ?? null;
    return dim(key, status, reached, steps, detail, figure);
  });
}

function sketch(s: Sketch): WorldProject {
  const dims = sketchDims(s);
  const solid = dims.filter((d) => d.status === 'solid').length;
  const bad = dims.filter((d) => d.status === 'alert' || d.status === 'risk').length;
  return {
    slug: s.slug,
    name: s.name,
    tag: s.tag,
    purpose: s.purpose,
    state: s.state,
    autoScore: Math.round(28 + s.maturity * 62 + hash01(`${s.slug}:auto`) * 8),
    prodScore: Math.round(22 + (solid / dims.length) * 70),
    lifecycle: s.lifecycle,
    blockers: bad,
    dims,
    fleet: s.fleet ?? [],
    personasRunning: s.personasRunning ?? [],
    ship: s.ship,
    llmSpend30d: s.llmSpend30d,
    monitorErrors: s.monitorErrors,
  };
}

const SKETCHES: Sketch[] = [
  {
    slug: 'gravitone',
    name: 'Gravitone',
    tag: 'GRV-03',
    purpose: 'CPU-native Arm text-to-speech — pocket-tts server plus a web console.',
    state: 'building',
    lifecycle: 'building',
    maturity: 0.52,
    strong: ['hosting', 'db'],
    weak: ['tests'],
    missing: ['kpi', 'support', 'datalinks'],
    fleet: [{ id: 'f-grv-1', name: 'wren', state: 'running' }],
    personasRunning: ['Bench Runner'],
    ship: { next: 'Voice pack v2', shipped: 2, total: 5, targetDate: '2026-10-04', late: false },
    llmSpend30d: 61,
    monitorErrors: 3,
  },
  {
    slug: 'ascent',
    name: 'Ascent',
    tag: 'ASC-04',
    purpose: 'Org-readiness console — live war-room metrics over the shared registry.',
    state: 'healthy',
    lifecycle: 'scaling',
    maturity: 0.78,
    strong: ['ci', 'monitoring'],
    missing: ['datalinks'],
    fleet: [
      { id: 'f-asc-1', name: 'ibis', state: 'running' },
      { id: 'f-asc-2', name: 'marten', state: 'idle' },
    ],
    personasRunning: ['Docs Scribe'],
    ship: { next: 'Scorecards', shipped: 9, total: 11, targetDate: '2026-09-22', late: false },
    llmSpend30d: 143,
    monitorErrors: 1,
  },
  {
    slug: 'personas-web',
    name: 'Personas Web',
    tag: 'PWB-05',
    purpose: 'Marketing site and guide library — the public face of the desktop app.',
    state: 'healthy',
    lifecycle: 'live',
    maturity: 0.71,
    strong: ['hosting'],
    missing: ['agents', 'skills'],
    weak: ['kpi'],
    ship: { next: 'Pricing page', shipped: 12, total: 13, targetDate: '2026-09-14', late: false },
    llmSpend30d: 9,
    monitorErrors: 0,
  },
  {
    slug: 'pumper',
    name: 'Pumper',
    tag: 'PMP-06',
    purpose: 'Token-flow analytics — ingest, score and surface on-chain movement.',
    state: 'warning',
    lifecycle: 'building',
    maturity: 0.46,
    broken: ['monitoring'],
    weak: ['security', 'ci'],
    strong: ['datalinks'],
    fleet: [{ id: 'f-pmp-1', name: 'shrike', state: 'awaiting_input' }],
    ship: { next: 'Alert rules', shipped: 4, total: 8, targetDate: '2026-09-12', late: true },
    llmSpend30d: 88,
    monitorErrors: 27,
  },
  {
    slug: 'politicas',
    name: 'Politicas',
    tag: 'PLT-07',
    purpose: 'Policy corpus and comparison engine with a public reading surface.',
    state: 'healthy',
    lifecycle: 'live',
    maturity: 0.74,
    strong: ['tests', 'db'],
    missing: ['support'],
    ship: { next: 'Corpus refresh', shipped: 6, total: 6, targetDate: null, late: false },
    llmSpend30d: 34,
    monitorErrors: 0,
  },
  {
    slug: 'vibeman',
    name: 'Vibeman',
    tag: 'VBM-08',
    purpose: 'Architecture workbench — repo maps, wizards and refactor plans.',
    state: 'building',
    lifecycle: 'building',
    maturity: 0.49,
    weak: ['tests', 'ideas'],
    missing: ['kpi', 'datalinks'],
    fleet: [{ id: 'f-vbm-1', name: 'stoat', state: 'idle' }],
    ship: { next: 'Plan diffing', shipped: 3, total: 7, targetDate: '2026-10-11', late: false },
    llmSpend30d: 52,
    monitorErrors: 6,
  },
  {
    slug: 'chainsonar',
    name: 'ChainSonar',
    tag: 'CHS-09',
    purpose: 'Contract-risk radar — dual-track research and a scoring dashboard.',
    state: 'critical',
    lifecycle: 'stalled',
    maturity: 0.27,
    broken: ['ci', 'security'],
    weak: ['db'],
    missing: ['monitoring', 'kpi', 'support', 'skills', 'goals'],
    fleet: [{ id: 'f-chs-1', name: 'pike', state: 'stale' }],
    ship: { next: 'Scoring v1', shipped: 1, total: 6, targetDate: '2026-08-29', late: true },
    llmSpend30d: 17,
    monitorErrors: null,
  },
  {
    slug: 'xprice',
    name: 'XPrice',
    tag: 'XPR-10',
    purpose: 'Seven-repo pricing lab — one SDLC team per repo, evaluated together.',
    state: 'building',
    lifecycle: 'piloting',
    maturity: 0.6,
    strong: ['agents', 'skills'],
    weak: ['hosting'],
    missing: ['datalinks'],
    fleet: [
      { id: 'f-xpr-1', name: 'osprey', state: 'running' },
      { id: 'f-xpr-2', name: 'sable', state: 'running' },
    ],
    personasRunning: ['QA Guardian', 'Planner'],
    ship: { next: 'Team certification', shipped: 5, total: 9, targetDate: '2026-10-01', late: false },
    llmSpend30d: 196,
    monitorErrors: 2,
  },
];

export const MOCK_WORLD: World = {
  projects: [PERSONAS, BRAINIAC, ...SKETCHES.map(sketch)],
  edges: [
    { from: 'personas', to: 'brainiac', kind: 'relation', strength: 1, label: 'memory API' },
    { from: 'personas', to: 'personas-web', kind: 'relation', strength: 1, label: 'guide sync' },
    { from: 'personas', to: 'gravitone', kind: 'relation', strength: 1, label: 'tts engine' },
    { from: 'brainiac', to: 'ascent', kind: 'relation', strength: 1, label: 'org memory' },
    { from: 'personas', to: 'xprice', kind: 'relation', strength: 1, label: 'sdlc teams' },
    { from: 'vibeman', to: 'ascent', kind: 'similarity', strength: 0.7, label: 'repo maps' },
    { from: 'pumper', to: 'chainsonar', kind: 'similarity', strength: 0.8, label: 'chain data' },
    { from: 'politicas', to: 'personas-web', kind: 'similarity', strength: 0.6, label: 'guide stack' },
  ],
};

/** Category order — the same order the 2D canvas paints. */
export const WORLD_CATEGORIES: DimCategory[] = ['runtime', 'delivery', 'agentic', 'product'];

/** Dimension keys of one category, registry order. */
export function categoryKeys(category: DimCategory): DimKey[] {
  return DIM_ORDER.filter((k) => DIM_REGISTRY[k].category === category);
}

/** A project's dims grouped by category, registry order inside each group. */
export function dimsByCategory(project: WorldProject): Array<{ category: DimCategory; dims: WorldDim[] }> {
  return WORLD_CATEGORIES.map((category) => ({
    category,
    dims: categoryKeys(category)
      .map((k) => project.dims.find((d) => d.key === k))
      .filter((d): d is WorldDim => Boolean(d)),
  }));
}

/** 0..1 progress of a dim — boolean dims are 1 when solid, else 0. */
export function dimProgress(d: WorldDim): number {
  if (d.steps <= 0) return d.status === 'solid' ? 1 : d.status === 'partial' ? 0.5 : 0;
  return Math.max(0, Math.min(1, d.reached / d.steps));
}

/** Dims that are actually WRONG (alert / risk), worst first. */
export function attentionDims(project: WorldProject): WorldDim[] {
  const rank: Record<DimStatus, number> = { alert: 0, risk: 1, unknown: 2, partial: 3, absent: 4, solid: 5 };
  return project.dims.filter((d) => d.status === 'alert' || d.status === 'risk').sort((a, b) => rank[a.status] - rank[b.status]);
}

export const findProject = (world: World, slug: string): WorldProject | undefined =>
  world.projects.find((p) => p.slug === slug);

// Mock world for the 3D Mastermind prototypes — TWO projects, hand-authored so
// every layer of the world has something specific to say (a healthy one that
// is shipping and a warning one with a real gap), plus the one relation that
// joins them. Deliberately NOT derived from live passports: the prototypes are
// evaluating node design, world sizing, colour, connectors and typography, and
// a fixed dataset is what makes three variants comparable side by side.
//
// Dimension keys, labels, categories and icons come from the real registry so
// the mock never invents a dimension the product does not have.
import { DIM_ORDER, DIM_REGISTRY, type DimCategory, type DimKey } from '../lib/dimRegistry';
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

export const MOCK_WORLD: World = {
  projects: [PERSONAS, BRAINIAC],
  edges: [
    { from: 'personas', to: 'brainiac', kind: 'relation', strength: 1, label: 'memory API' },
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

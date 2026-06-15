// Shared mock dataset for the Factory KPI-management prototypes.
//
// This is THROWAWAY prototype data — no store, no Tauri, no real KPIs. It
// models the real domain shape (project → context group → context → KPI set)
// so the three variants can prove a multilayer drill-down UX before we wire
// the actual `dev_kpis` data in. Calibration affordances (threshold bands,
// manual rating, measurement cadence) are first-class here because steering
// development by tuning thresholds is the whole point of the surface.

export type KpiCategory = 'technical' | 'quality' | 'traffic' | 'value';
export type KpiTier = 'north_star' | 'primary' | 'supporting';
export type MeasureKind = 'codebase' | 'connector' | 'manual' | 'derived';
export type ContextCategory = 'ui' | 'api' | 'lib' | 'data' | 'test' | 'config';
export type GroupDomain = 'feature' | 'infrastructure' | 'shared' | 'integration' | 'data';

/** Calibration band a KPI currently sits in. Richer than the 4-state app track
 *  so the detail view can render warn/crit thresholds as distinct zones. */
export type KpiStatus = 'met' | 'ok' | 'warn' | 'crit' | 'unmeasured';

export interface MockKpi {
  id: string;
  name: string;
  category: KpiCategory;
  tier: KpiTier;
  measureKind: MeasureKind;
  unit: string;
  direction: 'up' | 'down';
  baseline: number;
  current: number | null; // null = unmeasured
  target: number;
  /** Threshold the user calibrates: crossing `warnAt` is a soft alert, `critAt` a hard one. */
  warnAt: number;
  critAt: number;
  cadence: 'daily' | 'weekly' | 'manual';
  /** 0–5 manual confidence/quality rating the user can dial in; null = unrated. */
  manualRating: number | null;
  /** Free-text note explaining the rating — the calibration journal entry. */
  ratingNote?: string | null;
  /** Extended assessment: what's working / what isn't about this signal. */
  pros?: string | null;
  cons?: string | null;
  /** The measurement methodic (JSON measure_config string) — surfaced for preview. */
  measureConfig?: string;
  lastMeasuredAt: string; // relative label, e.g. "2h ago"
  series: number[]; // oldest → newest, for sparklines
}

export interface MockContext {
  id: string;
  name: string;
  category: ContextCategory;
  kpis: MockKpi[];
}

export interface MockGroup {
  id: string;
  name: string;
  domain: GroupDomain;
  color: string;
  contexts: MockContext[];
}

export interface MockProject {
  id: string;
  name: string;
  stack: string;
  groups: MockGroup[];
}

// -- token palette (semantic CSS vars — siblings of the live app) -------------

/** Universal traffic-light palette — green = good, yellow = at risk, red = off
 *  track, gray = unmeasured. The whole point: good/bad readable at first sight. */
export const TRAFFIC_COLOR = {
  green: 'var(--success)',
  yellow: 'var(--warning, #eab308)',
  red: 'var(--destructive)',
  gray: 'var(--muted-foreground)',
} as const;
export type Traffic = keyof typeof TRAFFIC_COLOR;

export function statusTraffic(s: KpiStatus): Traffic {
  return s === 'met' || s === 'ok' ? 'green' : s === 'warn' ? 'yellow' : s === 'crit' ? 'red' : 'gray';
}

/** Status → traffic colour. `met` and `ok` are BOTH green by design (first-sight
 *  good/bad); the met-vs-ok nuance survives in STATUS_LABEL + a ✓ where it counts. */
export const STATUS_COLOR: Record<KpiStatus, string> = {
  met: TRAFFIC_COLOR.green,
  ok: TRAFFIC_COLOR.green,
  warn: TRAFFIC_COLOR.yellow,
  crit: TRAFFIC_COLOR.red,
  unmeasured: TRAFFIC_COLOR.gray,
};

export const STATUS_LABEL: Record<KpiStatus, string> = {
  met: 'Target met',
  ok: 'On track',
  warn: 'At risk',
  crit: 'Off track',
  unmeasured: 'Unmeasured',
};

export const CATEGORY_LABEL: Record<KpiCategory, string> = {
  technical: 'Technical',
  quality: 'Quality',
  traffic: 'Traffic',
  value: 'Value',
};

export const DOMAIN_LABEL: Record<GroupDomain, string> = {
  feature: 'Feature',
  infrastructure: 'Infrastructure',
  shared: 'Shared',
  integration: 'Integration',
  data: 'Data',
};

// -- derivations --------------------------------------------------------------

export function kpiStatus(k: MockKpi): KpiStatus {
  if (k.current == null) return 'unmeasured';
  const better = k.direction === 'down' ? k.current <= k.target : k.current >= k.target;
  if (better) return 'met';
  const breach = (t: number) => (k.direction === 'down' ? k.current! >= t : k.current! <= t);
  if (breach(k.critAt)) return 'crit';
  if (breach(k.warnAt)) return 'warn';
  return 'ok';
}

/** 0–100 progress from baseline toward target, direction-aware, clamped. */
export function progressPct(k: MockKpi): number | null {
  if (k.current == null || k.target === k.baseline) return null;
  const frac = (k.current - k.baseline) / (k.target - k.baseline);
  return Math.round(Math.min(1, Math.max(0, frac)) * 100);
}

export interface Rollup {
  total: number;
  met: number;
  ok: number;
  warn: number;
  crit: number;
  unmeasured: number;
  /** 0–100 health = (met + ok) / measured, weighted by tier. */
  health: number;
}

export function rollup(kpis: MockKpi[]): Rollup {
  const r: Rollup = { total: kpis.length, met: 0, ok: 0, warn: 0, crit: 0, unmeasured: 0, health: 0 };
  let weightSum = 0;
  let scoreSum = 0;
  const tierW: Record<KpiTier, number> = { north_star: 3, primary: 2, supporting: 1 };
  for (const k of kpis) {
    const s = kpiStatus(k);
    r[s] += 1;
    if (s === 'unmeasured') continue;
    const w = tierW[k.tier];
    const sc = s === 'met' ? 1 : s === 'ok' ? 0.75 : s === 'warn' ? 0.4 : 0;
    weightSum += w;
    scoreSum += w * sc;
  }
  r.health = weightSum > 0 ? Math.round((scoreSum / weightSum) * 100) : 0;
  return r;
}

/** A user's pending calibration edits for one KPI (mock — lives in component state). */
export interface KpiEdit {
  warnAt?: number;
  critAt?: number;
  rating?: number;
  ratingNote?: string;
  pros?: string;
  cons?: string;
}
/** Apply pending threshold/rating edits to a KPI (returns a new object). */
export function applyEdit(k: MockKpi, e?: KpiEdit): MockKpi {
  if (!e) return k;
  return {
    ...k,
    warnAt: e.warnAt ?? k.warnAt,
    critAt: e.critAt ?? k.critAt,
    manualRating: e.rating ?? k.manualRating,
    ratingNote: e.ratingNote ?? k.ratingNote,
    pros: e.pros ?? k.pros,
    cons: e.cons ?? k.cons,
  };
}

/** Format a value with its unit: space word-units ("0 errors") but not "%" ("78%"). */
export function fmtUnit(v: number | null | undefined, unit: string): string {
  const num = v ?? '—';
  return unit && unit !== '%' ? `${num} ${unit}` : `${num}${unit}`;
}

/** Green/yellow/red/gray tallies for a set of KPIs — the traffic-light summary. */
export function trafficCounts(kpis: MockKpi[]): Record<Traffic, number> {
  const c: Record<Traffic, number> = { green: 0, yellow: 0, red: 0, gray: 0 };
  for (const k of kpis) c[statusTraffic(kpiStatus(k))] += 1;
  return c;
}

/** Worst-wins traffic colour for a node — red if any red, else yellow, etc. */
export function worstTraffic(kpis: MockKpi[]): Traffic {
  const c = trafficCounts(kpis);
  return c.red > 0 ? 'red' : c.yellow > 0 ? 'yellow' : c.green > 0 ? 'green' : 'gray';
}

export const KPI_CATEGORIES: KpiCategory[] = ['technical', 'quality', 'traffic', 'value'];

export function contextKpis(c: MockContext): MockKpi[] {
  return c.kpis;
}
export function groupKpis(g: MockGroup): MockKpi[] {
  return g.contexts.flatMap((c) => c.kpis);
}
export function projectKpis(p: MockProject): MockKpi[] {
  return p.groups.flatMap(groupKpis);
}

// -- builders -----------------------------------------------------------------

let _id = 0;
const nid = (p: string) => `${p}-${++_id}`;

/** Deterministic noisy trend from `from` → `to` (no Math.random so it's stable across renders). */
function trend(from: number, to: number, n = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const wob = Math.sin(i * 1.7 + from) * Math.abs(to - from) * 0.05;
    out.push(Math.round((from + (to - from) * f + wob) * 100) / 100);
  }
  return out;
}

function k(
  name: string,
  category: KpiCategory,
  tier: KpiTier,
  measureKind: MeasureKind,
  unit: string,
  direction: 'up' | 'down',
  baseline: number,
  current: number | null,
  target: number,
  warnAt: number,
  critAt: number,
  cadence: 'daily' | 'weekly' | 'manual',
  manualRating: number | null,
  lastMeasuredAt: string,
): MockKpi {
  return {
    id: nid('kpi'),
    name,
    category,
    tier,
    measureKind,
    unit,
    direction,
    baseline,
    current,
    target,
    warnAt,
    critAt,
    cadence,
    manualRating,
    lastMeasuredAt,
    series: current == null ? [] : trend(baseline, current),
  };
}

const ctx = (name: string, category: ContextCategory, kpis: MockKpi[]): MockContext => ({
  id: nid('ctx'),
  name,
  category,
  kpis,
});
const grp = (name: string, domain: GroupDomain, color: string, contexts: MockContext[]): MockGroup => ({
  id: nid('grp'),
  name,
  domain,
  color,
  contexts,
});
const proj = (name: string, stack: string, groups: MockGroup[]): MockProject => ({
  id: nid('proj'),
  name,
  stack,
  groups,
});

// -- the dataset (5 projects, mixed health) -----------------------------------

export const MOCK_PROJECTS: [MockProject, ...MockProject[]] = [
  proj('ai-paralegal', 'Next.js · Postgres · OpenAI', [
    grp('Document Intake', 'feature', '#6366f1', [
      ctx('upload-flow', 'ui', [
        k('Upload success rate', 'quality', 'primary', 'derived', '%', 'up', 88, 94, 99, 92, 85, 'daily', 4, '1h ago'),
        k('p95 parse latency', 'technical', 'supporting', 'codebase', 'ms', 'down', 4200, 3100, 1500, 2500, 4000, 'daily', null, '1h ago'),
        k('Throughput', 'traffic', 'supporting', 'derived', 'docs/h', 'up', 120, 180, 400, 140, 100, 'daily', null, '1h ago'),
        k('Reprocessing cost', 'value', 'supporting', 'connector', '$/k', 'down', 1.2, 0.9, 0.3, 1, 1.5, 'weekly', null, '1d ago'),
        k('Lint debt', 'technical', 'supporting', 'codebase', '/100', 'down', 30, 18, 5, 20, 30, 'weekly', 3, '2d ago'),
      ]),
      ctx('ocr-pipeline', 'lib', [
        k('OCR accuracy', 'quality', 'north_star', 'manual', '%', 'up', 91, 93, 98, 94, 90, 'weekly', 3, '2d ago'),
      ]),
    ]),
    grp('Case Research', 'feature', '#10b981', [
      ctx('citation-engine', 'api', [
        k('Hallucinated citations', 'quality', 'north_star', 'manual', '/100', 'down', 12, 9, 1, 5, 9, 'weekly', 2, '3d ago'),
        k('Answer relevance', 'value', 'primary', 'manual', '%', 'up', 70, 78, 90, 80, 70, 'weekly', 4, '3d ago'),
      ]),
      ctx('search-index', 'data', [
        k('Index freshness', 'technical', 'supporting', 'derived', 'min', 'down', 60, 22, 5, 30, 60, 'daily', null, '20m ago'),
      ]),
    ]),
    grp('Billing', 'integration', '#f59e0b', [
      ctx('stripe-sync', 'api', [
        k('Monthly revenue', 'value', 'north_star', 'connector', '$k', 'up', 18, 24, 50, 22, 18, 'daily', null, '4h ago'),
        k('Failed charges', 'value', 'supporting', 'connector', '%', 'down', 3.1, 2.2, 0.5, 2, 3, 'daily', null, '4h ago'),
      ]),
    ]),
  ]),

  proj('shopfront', 'React · Node · Stripe', [
    grp('Storefront', 'feature', '#8b5cf6', [
      ctx('product-grid', 'ui', [
        k('LCP', 'technical', 'primary', 'codebase', 's', 'down', 3.8, 2.1, 1.5, 2.5, 3.5, 'weekly', 4, '6h ago'),
        k('Add-to-cart rate', 'traffic', 'primary', 'connector', '%', 'up', 4.2, 5.1, 8, 4.5, 3.5, 'daily', null, '1h ago'),
        k('Bounce rate', 'quality', 'primary', 'connector', '%', 'down', 52, 47, 30, 50, 60, 'daily', null, '1h ago'),
        k('Revenue / visit', 'value', 'primary', 'connector', '$', 'up', 1.8, 2.3, 4, 1.9, 1.5, 'daily', null, '1h ago'),
        k('Image weight', 'technical', 'supporting', 'codebase', 'KB', 'down', 900, 620, 300, 700, 1000, 'weekly', null, '3d ago'),
      ]),
      ctx('reviews', 'ui', [
        k('Review coverage', 'quality', 'supporting', 'derived', '%', 'up', 40, 52, 80, 50, 35, 'weekly', null, '2d ago'),
      ]),
    ]),
    grp('Checkout', 'feature', '#ef4444', [
      ctx('cart-api', 'api', [
        k('Checkout conversion', 'value', 'north_star', 'connector', '%', 'up', 48, 44, 65, 50, 45, 'daily', 2, '30m ago'),
        k('Cart error rate', 'quality', 'primary', 'derived', '%', 'down', 1.8, 3.4, 0.5, 1.5, 2.5, 'daily', null, '30m ago'),
      ]),
      ctx('payment-gateway', 'api', [
        k('Payment success', 'value', 'north_star', 'connector', '%', 'up', 97.5, 98.9, 99.5, 98, 96, 'daily', null, '12m ago'),
      ]),
    ]),
    grp('Inventory', 'data', '#06b6d4', [
      ctx('stock-sync', 'data', [
        k('Oversell incidents', 'quality', 'supporting', 'manual', '/wk', 'down', 6, 2, 0, 3, 6, 'weekly', 3, '5d ago'),
      ]),
    ]),
  ]),

  proj('fleet-ops', 'Tauri · Rust · SQLite', [
    grp('Telemetry', 'infrastructure', '#3b82f6', [
      ctx('ingest', 'api', [
        k('Events dropped', 'technical', 'primary', 'derived', '%', 'down', 0.9, 0.3, 0.1, 0.5, 1, 'daily', null, '8m ago'),
        k('Ingest throughput', 'technical', 'supporting', 'derived', 'k/s', 'up', 12, 18, 30, 14, 10, 'daily', null, '8m ago'),
      ]),
      ctx('storage', 'data', [
        k('Test coverage', 'technical', 'supporting', 'codebase', '%', 'up', 61, 68, 85, 65, 55, 'weekly', 4, '1d ago'),
      ]),
    ]),
    grp('Routing', 'feature', '#10b981', [
      ctx('optimizer', 'lib', [
        k('Route efficiency', 'value', 'north_star', 'manual', '%', 'up', 72, 79, 92, 78, 70, 'weekly', 4, '2d ago'),
        k('Solver p99', 'technical', 'supporting', 'codebase', 'ms', 'down', 900, 640, 300, 600, 900, 'weekly', null, '2d ago'),
      ]),
    ]),
    grp('Dispatch', 'feature', '#f59e0b', [
      ctx('assignment', 'api', [
        k('Driver acceptance', 'value', 'primary', 'connector', '%', 'up', 80, 76, 90, 82, 75, 'daily', 3, '1h ago'),
      ]),
    ]),
  ]),

  proj('healthsync', 'Vue · Mongo · Twilio', [
    grp('Scheduling', 'feature', '#ec4899', [
      ctx('calendar', 'ui', [
        k('No-show rate', 'value', 'north_star', 'derived', '%', 'down', 18, 14, 6, 12, 18, 'weekly', 3, '3d ago'),
      ]),
      ctx('booking-api', 'api', [
        k('Booking p95', 'technical', 'supporting', 'codebase', 'ms', 'down', 800, 520, 250, 500, 800, 'daily', null, '2h ago'),
        k('Slot fill rate', 'value', 'primary', 'derived', '%', 'up', 60, 67, 85, 62, 50, 'weekly', null, '3d ago'),
      ]),
    ]),
    grp('Records', 'data', '#14b8a6', [
      ctx('sync-engine', 'data', [
        k('Sync conflicts', 'quality', 'primary', 'manual', '/wk', 'down', 9, 11, 1, 5, 9, 'weekly', 2, '6d ago'),
      ]),
    ]),
    grp('Notifications', 'integration', '#f97316', [
      ctx('sms-gateway', 'api', [
        k('Delivery rate', 'quality', 'primary', 'connector', '%', 'up', 94, null, 99, 96, 92, 'daily', null, 'never'),
      ]),
    ]),
  ]),

  proj('devportal', 'Astro · Edge · Clerk', [
    grp('Docs', 'feature', '#6366f1', [
      ctx('search', 'ui', [
        k('Search success', 'value', 'primary', 'derived', '%', 'up', 55, 71, 85, 60, 50, 'weekly', 5, '1d ago'),
      ]),
      ctx('content', 'config', [
        k('Stale pages', 'quality', 'supporting', 'codebase', '/100', 'down', 22, 9, 2, 12, 20, 'weekly', null, '4d ago'),
      ]),
    ]),
    grp('Auth', 'infrastructure', '#a855f7', [
      ctx('clerk-bridge', 'api', [
        k('Login success', 'quality', 'north_star', 'connector', '%', 'up', 98.2, 99.4, 99.9, 99, 98, 'daily', null, '15m ago'),
        k('Signup drop-off', 'value', 'primary', 'connector', '%', 'down', 40, 31, 15, 35, 45, 'daily', 3, '15m ago'),
      ]),
    ]),
    grp('Analytics', 'integration', '#22c55e', [
      ctx('posthog', 'api', [
        k('Weekly active devs', 'traffic', 'north_star', 'connector', '', 'up', 320, 410, 1000, 350, 280, 'daily', null, '1h ago'),
      ]),
    ]),
  ]),
];

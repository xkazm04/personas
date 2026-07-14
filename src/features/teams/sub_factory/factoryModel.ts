// Factory view-model: domain types, label maps, and pure derivations shared by
// the Factory KPI-management layers (L1 projects → L2 context × KPI matrix →
// L3 table → L4 console). The live adapter (factoryData.tsx /
// FactoryDataProvider) maps real dev_tools rows into these shapes; the layers
// consume them unchanged. The `Mock*` type names are historical — they date
// from the deleted throwaway prototype dataset (factoryMock.ts / MOCK_PROJECTS)
// that first modeled the shape; renaming them is a mechanical follow-up.

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
  /** Display name of the use case this KPI is scoped to — a behavioral slice
   *  through contexts, the narrowest KPI scope. Null when scoped to a context,
   *  group, or the project. See docs/plans/use-case-slice-layer.md. */
  useCaseName?: string | null;
  /** Derivation looked at this off-track KPI and judged nothing team-actionable
   *  would move it; true only while that verdict is fresh (set since the last
   *  measurement). Surfaced as the honest "over to you" state. */
  skipFresh?: boolean;
  skipRationale?: string | null;
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

// Human labels for the remaining enums, so the UI never shows a raw token
// (D7 acceptance: zero raw enum tokens visible). English for now; the whole
// Factory still awaits an i18n pass.
export const KIND_LABEL: Record<MeasureKind, string> = {
  codebase: 'Codebase',
  connector: 'Connector',
  manual: 'Manual',
  derived: 'Derived',
};

export const CADENCE_LABEL: Record<'daily' | 'weekly' | 'manual', string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  manual: 'Manual',
};

export const TIER_LABEL: Record<KpiTier, string> = {
  north_star: 'North star',
  primary: 'Primary',
  supporting: 'Supporting',
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

/** A user's pending calibration edits for one KPI (lives in component state). */
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

/** One off-track KPI. Shared shape so the Factory warning badge and the findings
 *  sweep's `kpi_offtrack` emitter can never disagree on what "off track" means. */
export interface KpiAttentionItem {
  groupId: string;
  kpiId: string;
  name: string;
  current: number | null;
  target: number;
  unit: string;
}

/** Every KPI on the project currently in `crit`. Extracted from ProjectsLayer so
 *  the findings sweep reads the SAME set the wall badges (dev-findings-loop §3 2B, E5). */
export function collectKpiAttention(p: MockProject): KpiAttentionItem[] {
  const items: KpiAttentionItem[] = [];
  for (const g of p.groups) {
    for (const k of groupKpis(g)) {
      if (kpiStatus(k) === 'crit') {
        items.push({
          groupId: g.id,
          kpiId: k.id,
          name: k.name,
          current: k.current,
          target: k.target,
          unit: k.unit,
        });
      }
    }
  }
  return items;
}

// PORTED from bp packages/core/src/model/timeview.ts @ 93f30b0 (spark bp-sync, WP1). Pure: no DOM, no IPC, no React.
// EDIT (port): only healthAsOf and replayTable come over (WP1 scope), with the three helpers they read, brought in
// from their bp homes so this module stands alone: isCurrent (bp packages/core/src/scan/derive.ts), metricHistory
// (bp packages/core/src/model/live.ts) and baseId (bp packages/core/src/model/product.ts). bp's stageView, valueView,
// readingsUpTo, recordAsOf and lensAsOf (the feature page's presenter, which composes English) are not ported here.
// HealthReplay's `label` (bp: "replayed by today's rules from N readings up to <date>") is dropped: `readings` and
// `upTo` are the data it was made from, and the sentence is the text hook's. stageAt is Personas' own
// (standard/present.ts, which engine/travel.ts reads too), not a copy. Scan types are src/lib/lensScan/wire.ts.
// Health has no stored history, but where a lens's rules read only metrics with a reading by then (and the replayed
// stage), healthAsOf re-runs TODAY's rules over THOSE readings. Anything else - other fields, KPIs, overrides - has
// no history: a now-value is never handed back for a date that is not now.
import type { Measurement, ScanSnapshot } from '@/lib/lensScan/wire';
import type { Feature, LensDef } from '../standard/load';
import type { Condition, FacetValues, Health } from '../standard/types';
import { conditionFields, evaluateLens, fillReason } from '../standard/health';
import { NUMERIC, stageAt } from '../standard/present';

/** A reading that counts as the product's state: a pack's `after` reading was taken on an unmerged branch (bp derive.ts). */
export const isCurrent = (m: Pick<Measurement, 'phase'>): boolean => m.phase !== 'after';

/** The id the scan stores for a feature: the map's slug, without a product-line suffix (bp product.ts). */
export function baseId(id: string): string {
  return id.replace(/-[A-Z]$/, '');
}

const HIST = new WeakMap<readonly Measurement[], Map<string, Measurement[]>>();
const hkey = (feature: string, lens: string, metric: string) => feature + '\u0000' + lens + '\u0000' + metric;
/** A metric's readings for one feature and lens, oldest first (cached per measurements table). A pack's `after`
 *  readings are left out: they were taken on an unmerged branch, not the product (isCurrent). */
export function metricHistory(scan: Pick<ScanSnapshot, 'measurements'> | undefined, feature: string, lens: string, metric: string): readonly Measurement[] {
  if (!scan) return [];
  let m = HIST.get(scan.measurements);
  if (!m) {
    m = new Map();
    for (const x of scan.measurements) { if (!isCurrent(x)) continue; const k = hkey(x.feature, x.lens, x.metric); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(x); }
    for (const a of m.values()) a.sort((p, q) => (p.measured_at < q.measured_at ? -1 : p.measured_at > q.measured_at ? 1 : p.id - q.id));
    HIST.set(scan.measurements, m);
  }
  return m.get(hkey(feature, lens, metric)) ?? [];
}

// ------------------------------------------------------------------ replayed health
/** A lens's health on a past date, re-run by today's rules over the readings in force then. */
export interface HealthReplay {
  health: Health;
  /** The matched rule's reason, filled with the replayed values (manifest text); null when only the default applies. */
  why: string | null;
  /** How many readings the facet was built from, and the newest one's date (bp's label is made of these two). */
  readings: number;
  upTo: string;
  /** The values the rules were run on (the readings, and the stage when a field is bound to it). */
  values: FacetValues;
}

/**
 * Today's rules over the readings in force on `t` (a past date; null at or after `asOf`). The facet is built FRESH:
 * each numeric, unbound field's last reading on or before the end of day `t` (metricHistory: a pack's `after`
 * readings never count), plus fields bound to the stage at `stageAt(f, t)`. The map's current facet values, its
 * overrides, its applicability marks and the KPIs are never carried into the past. A pair is replayed only when
 * every field the lens's usable rules and `applies_when` read is such a reading or the stage; anything else (an enum
 * judged by hand, a KPI, another feature field, a metric not yet read by then) leaves it null: not recorded.
 */
export function healthAsOf(f: Pick<Feature, 'id' | 'stage' | 'revs'>, d: Pick<LensDef, 'id' | 'manifest'>, scan: Pick<ScanSnapshot, 'measurements'> | undefined, t: string, asOf: string): HealthReplay | null {
  const m = d.manifest;
  if (t >= asOf || !scan || !m?.health?.rules || !m.fields) return null;
  const F = new Map(m.fields.map((x) => [x.key, x] as const));
  const usable = (c: Condition) => conditionFields(c).every((k) => F.has(k));
  const reads = new Set<string>();
  for (const r of m.health.rules) if (usable(r.when)) for (const k of conditionFields(r.when)) reads.add(k);
  const aw = m.health.applies_when;
  if (aw && usable(aw)) for (const k of conditionFields(aw)) reads.add(k);
  const id = baseId(f.id), values: FacetValues = {};
  let readings = 0, upTo = '';
  for (const x of m.fields) {
    if (x.source || !NUMERIC.has(x.type)) continue;
    let hit: { value: number; day: string } | null = null;
    for (const r of metricHistory(scan, id, d.id, x.key)) {
      const day = r.measured_at.slice(0, 10);
      if (day > t) break;
      if (typeof r.value === 'number' && Number.isFinite(r.value)) hit = { value: r.value, day };
    }
    if (!hit) continue;
    values[x.key] = hit.value; readings++;
    if (hit.day > upTo) upTo = hit.day;
  }
  if (!readings) return null;
  const stage = stageAt(f, t, asOf);
  for (const k of reads) {
    const x = F.get(k)!;
    if (x.source) { if (!('feature' in x.source) || x.source.feature !== 'stage' || !stage) return null; continue; }
    if (values[k] === undefined) return null;
  }
  const e = evaluateLens(m, { values }, t, { feature: stage ? { stage } : {} });
  return { health: e.health, why: e.rule ? fillReason(e.rule.reason, e.values) : null, readings, upTo, values: e.values };
}

/** The replayed health of every pair on one past date: feature id -> lens id -> health (see replayTable). */
export type ReplayTable = ReadonlyMap<string, ReadonlyMap<string, Health>>;

/**
 * The replayed health of every (feature, lens) pair on `t`, for drawing a past date. Only replayable pairs appear: a
 * missing entry is "not recorded", never "good". null at or after `asOf` (read the live model). A caller computes it
 * once per travelled date and scan table, never per frame.
 */
export function replayTable(features: readonly Pick<Feature, 'id' | 'stage' | 'revs'>[], lenses: readonly Pick<LensDef, 'id' | 'manifest'>[], scan: Pick<ScanSnapshot, 'measurements'> | undefined, t: string, asOf: string): ReplayTable | null {
  if (t >= asOf) return null;
  const out = new Map<string, Map<string, Health>>();
  if (!scan) return out;
  for (const f of features) for (const d of lenses) {
    const r = healthAsOf(f, d, scan, t, asOf);
    if (!r) continue;
    let row = out.get(f.id);
    if (!row) out.set(f.id, (row = new Map()));
    row.set(d.id, r.health);
  }
  return out;
}

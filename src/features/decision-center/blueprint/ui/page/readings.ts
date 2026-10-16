// What the feature page reads for a date (bp lib/model/timeview.ts) and a lens's metric rows (bp sheet/LensPanel.tsx
// metricRows / metricMove). Only what the data records is shown for a past date: the stage, replayed from the
// revisions (standard/present.ts stageAt), and a metric's readings (the store keeps every measurement with its time).
// Health and the other fields have no history, so a past date says so: a now-value is never handed back for it.
// A metric's history is the store's non-phased readings (model/work.ts series): a pack's before and after captures
// were taken on a branch, not the product. Pure; no React.
import type { Measurement } from '@/lib/lensScan/wire';
import { stageAt } from '../../standard/present';
import { fval, type Feature, type LensDef } from '../../standard/load';
import type { LensField, Stage } from '../../standard/types';

export type Series = (fid: string, lens: string, metric: string) => Measurement[];

export type StageAsOf = { at: 'now'; stage: Stage | null } | { at: 'then'; stage: Stage } | { at: 'before' } | { at: 'unknown' };

/** The stage on `t` (the page's date); `now` is the data's own as-of date. */
export function stageView(f: Feature, t: string, now: string): StageAsOf {
  if (t >= now) return { at: 'now', stage: f.stage };
  const s = stageAt(f, t, now);
  if (s) return { at: 'then', stage: s };
  return f.revs.length ? { at: 'before' } : { at: 'unknown' };
}

export type ValueAsOf = { at: 'now' } | { at: 'then'; value: number; measured: string } | { at: 'none' };

/** A field's value on `t`: only a metric field has a history; the last reading taken on or before day `t`. */
export function valueView(series: Series, f: Feature, lens: string, field: LensField, t: string, now: string): ValueAsOf {
  if (t >= now) return { at: 'now' };
  if (!field.metric) return { at: 'none' };
  let hit: { value: number; measured: string } | null = null;
  for (const m of series(f.id, lens, field.key)) {
    if (m.measured_at.slice(0, 10) > t) break;
    hit = { value: m.value, measured: m.measured_at.slice(0, 10) };
  }
  return hit ? { at: 'then', ...hit } : { at: 'none' };
}

export interface MetricRow { field: LensField; value: number | undefined; prev: number | undefined; pts: number[]; unit: string; method: string; evidence: string | undefined }

/**
 * A lens's metric fields for one feature, oldest reading first. Without a history the facet's value is the single
 * point (now only: the facet is today's). The value is the latest reading; the unit is the manifest's when it has
 * one, else the reading's; the evidence is the latest reading's own text.
 */
export function metricRows(d: LensDef, f: Feature, series: Series, t: string, now: string): MetricRow[] {
  const out: MetricRow[] = [], past = t < now;
  for (const fd of d.fields) {
    const m = fd.metric; if (!m) continue;
    const all = series(f.id, d.id, fd.key), h = past ? all.filter((x) => x.measured_at.slice(0, 10) <= t) : all;
    const fv = past ? undefined : fval(f, d.id, fd.key);
    const pts = h.length ? h.map((x) => x.value) : typeof fv === 'number' ? [fv] : [];
    const last = h[h.length - 1];
    const unit = fd.unit || fd.type === 'percent' || !last?.unit || last.unit === '%' ? '' : ' ' + last.unit;
    out.push({ field: fd, value: pts[pts.length - 1], prev: pts.length > 1 ? pts[pts.length - 2] : undefined, pts, unit, method: last?.method ?? m.method, evidence: last?.evidence?.trim() || undefined });
  }
  return out;
}

/** How a metric moved against its previous reading, and whether that is the better way (`metric.better`). */
export function metricMove(r: MetricRow): { dir: 'up' | 'down' | null; cls: 'good' | 'bad' | '' } {
  const v = r.value, p = r.prev;
  if (v === undefined || p === undefined || v === p) return { dir: null, cls: '' };
  const dir = v > p ? 'up' : 'down';
  return { dir, cls: dir === r.field.metric?.better ? 'good' : 'bad' };
}

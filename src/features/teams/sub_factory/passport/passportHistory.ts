// Readiness HISTORY — a local time series of each project's passport so the Wall
// stops being amnesiac. Snapshots are derived client-side, so we persist them in
// localStorage (no backend table needed for v1): one append-only series per
// project, deduped so only real changes are recorded. Powers the cover sparkline
// + "since last scan" delta, and (later) regression alerts.
import type { AppPassport } from './passportModel';
import { scoreAgainstRubric } from './improve/goldenStandard';
import { silentCatch } from '@/lib/silentCatch';

export interface PassportSnapshot {
  /** epoch ms */
  t: number;
  /** automationReadiness.score 0..100 */
  auto: number;
  /** productionReadiness.score 0..100 */
  prod: number;
  /** golden-standard % 0..100 */
  golden: number;
}

type HistoryMap = Record<string, PassportSnapshot[]>;

const KEY = 'passport_history_v1';
const MAX_PER_PROJECT = 40;

function isSnapshot(v: unknown): v is PassportSnapshot {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.t === 'number' && typeof o.auto === 'number' && typeof o.prod === 'number' && typeof o.golden === 'number';
}

/** Parse the stored map at the boundary. localStorage is outside this
 *  module's control (an older shape, a hand edit, a partial write), and a
 *  non-array series used to reach `series.push` in recordSnapshot: the throw
 *  failed the Wall's evidence-complete build on every scan, permanently,
 *  because the bad value stayed stored. Malformed entries are dropped. */
function load(): HistoryMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: HistoryMap = {};
    for (const [slug, series] of Object.entries(parsed)) {
      if (Array.isArray(series)) map[slug] = series.filter(isSnapshot);
    }
    return map;
  } catch {
    return {};
  }
}

function save(map: HistoryMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch (e) {
    // quota / unavailable — history is best-effort, never block the Wall
    silentCatch('passportHistory:save')(e);
  }
}

function sameReadings(a: PassportSnapshot, b: { auto: number; prod: number; golden: number }): boolean {
  return a.auto === b.auto && a.prod === b.prod && a.golden === b.golden;
}

/**
 * Record the current passports into the history, deduped: a project's series
 * only grows when its readings actually change, so opening the Wall repeatedly
 * doesn't inflate the trend. `now` is injected (the codebase forbids Date.now()
 * in some contexts and it keeps this testable).
 */
export function recordSnapshot(passports: AppPassport[], now: number): void {
  if (passports.length === 0) return;
  const map = load();
  let changed = false;
  for (const p of passports) {
    const slug = p.identity.slug;
    const reading = {
      auto: p.automationReadiness.score,
      prod: p.productionReadiness.score,
      golden: scoreAgainstRubric(p).goldenPct,
    };
    const series = map[slug] ?? [];
    const last = series[series.length - 1];
    if (last && sameReadings(last, reading)) continue; // no change → no new point
    series.push({ t: now, ...reading });
    map[slug] = series.slice(-MAX_PER_PROJECT);
    changed = true;
  }
  if (changed) save(map);
}

/** The recorded series for a project (oldest → newest). */
export function getHistory(slug: string): PassportSnapshot[] {
  return load()[slug] ?? [];
}

export interface TrendDelta {
  auto: number;
  prod: number;
  golden: number;
  /** how many snapshots back the comparison is (0 when only one point exists) */
  span: number;
}

/** Change vs the previous DISTINCT snapshot (the last real move). Null when there's no prior point. */
export function trendDelta(slug: string): TrendDelta | null {
  const s = getHistory(slug);
  if (s.length < 2) return null;
  const cur = s[s.length - 1]!;
  const prev = s[s.length - 2]!;
  return { auto: cur.auto - prev.auto, prod: cur.prod - prev.prod, golden: cur.golden - prev.golden, span: 1 };
}

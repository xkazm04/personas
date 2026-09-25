/**
 * The daytime door on the monthly spend ceiling.
 *
 * `LimitsSettings` has always computed the 80% and 100% crossings, but they
 * only coloured a progress bar: nothing told the operator while they could
 * still pause work, so a cap was something you discovered after the month
 * closed. This module is the decision half, kept pure so the "exactly one
 * durable alert per threshold per calendar month" rule is testable without a
 * store, a clock or a render.
 *
 * Dedupe is keyed by calendar month because that is the ceiling's own period:
 * re-opening Settings, a re-fetch, or a third crossing in the same month must
 * not produce a second alert, and the next month starts clean.
 */

import { createThrottledLocalStorage } from '@/lib/throttledStorage';
import { silentCatch } from '@/lib/silentCatch';
import { parseNotificationPrefs } from '@/lib/notifications/notificationPrefs';
import { bucketMonthlySpend, parseCeiling, type SpendPoint } from './monthlySpend';

export type SpendAlertBand = 'approaching' | 'over';

/** The 80% shoulder, mirrored from `LimitsSettings`'s WARNING_THRESHOLD. */
export const SPEND_WARNING_RATIO = 0.8;

export interface SpendAlertInput {
  /** `YYYY-MM` of the month being judged. */
  monthKey: string;
  spend: number;
  /** `0` means "no ceiling set" — never alert. */
  ceiling: number;
  /** Bands already alerted for this month. */
  alreadySent: readonly SpendAlertBand[];
}

/**
 * The band to alert on now, or `null` when nothing new has been crossed.
 *
 * Crossing straight from nothing to over-budget emits only `over` — the
 * operator does not need to be told twice, and the `approaching` band is
 * recorded as delivered so a later re-render cannot emit it retroactively.
 */
export function decideSpendAlert({
  spend,
  ceiling,
  alreadySent,
}: SpendAlertInput): SpendAlertBand | null {
  if (!Number.isFinite(ceiling) || ceiling <= 0) return null;
  if (!Number.isFinite(spend) || spend <= 0) return null;

  const ratio = spend / ceiling;
  if (ratio >= 1) {
    return alreadySent.includes('over') ? null : 'over';
  }
  if (ratio >= SPEND_WARNING_RATIO) {
    if (alreadySent.includes('over') || alreadySent.includes('approaching')) return null;
    return 'approaching';
  }
  return null;
}

/**
 * The bands to record as delivered once `band` has been emitted. Emitting
 * `over` also retires `approaching`, so a bar that jumps the shoulder never
 * back-fills a warning the operator no longer needs.
 */
export function bandsRetiredBy(band: SpendAlertBand): SpendAlertBand[] {
  return band === 'over' ? ['approaching', 'over'] : ['approaching'];
}

export interface SpendAlertTickInput {
  /** Raw `monthly_cost_ceiling_usd` setting value. */
  ceilingRaw: string | null;
  /** Raw `notification_prefs` blob; its `spend_alerts` field gates the alert. */
  prefsRaw: string | null;
  /** Daily cost points (`get_metrics_chart_data`), bucketed here by month. */
  chartPoints: readonly SpendPoint[];
  /**
   * Bands already delivered: a list for the month being judged, or a reader
   * keyed by month (`readSentBands`), since the month is only known once the
   * points are bucketed.
   */
  alreadySent: readonly SpendAlertBand[] | ((monthKey: string) => readonly SpendAlertBand[]);
}

/**
 * The runner half: raw settings + chart points in, the band to emit out. It
 * used to live in a LimitsSettings effect, so it ran only while the operator
 * was looking at the Limits tab; `SpendAlertWatcher` now runs it always-on.
 * Pure: the caller records the band and emits the notification.
 */
export function runSpendAlertTick({
  ceilingRaw,
  prefsRaw,
  chartPoints,
  alreadySent,
}: SpendAlertTickInput): { monthKey: string; band: SpendAlertBand } | null {
  if (!parseNotificationPrefs(prefsRaw).spend_alerts) return null;
  const ceiling = parseCeiling(ceilingRaw);
  if (ceiling <= 0) return null;
  const head = bucketMonthlySpend(chartPoints)[0];
  if (!head) return null;
  const sent = typeof alreadySent === 'function' ? alreadySent(head.key) : alreadySent;
  const band = decideSpendAlert({ monthKey: head.key, spend: head.spend, ceiling, alreadySent: sent });
  return band ? { monthKey: head.key, band } : null;
}

const STORAGE_KEY = 'spend_ceiling_alerts_sent';

// The sanctioned Web Storage primitive — raw `localStorage` outside the storage
// layer is what `raw-web-storage` exists to stop. Reads see a pending write, so
// a second render in the same session cannot re-emit an alert.
const storage = createThrottledLocalStorage();

type SentLedger = { monthKey: string; bands: SpendAlertBand[] };

function isBand(v: unknown): v is SpendAlertBand {
  return v === 'approaching' || v === 'over';
}

/**
 * Bands already alerted for `monthKey`. Only the current month is retained, so
 * the ledger cannot grow and a new month always starts empty. Returns `[]` on
 * any storage failure (private window, blocked site data) — a duplicate alert
 * is a smaller harm than a silent one.
 */
export function readSentBands(monthKey: string): SpendAlertBand[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // Narrowed field by field rather than asserted: this blob is whatever a
    // previous version of the app (or a hand-edited store) left behind.
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const ledger = parsed as Partial<SentLedger>;
    if (ledger.monthKey !== monthKey || !Array.isArray(ledger.bands)) return [];
    return ledger.bands.filter(isBand);
  } catch {
    return [];
  }
}

/** Record `band` (and anything it retires) as delivered for `monthKey`. */
export function recordSentBand(monthKey: string, band: SpendAlertBand): void {
  try {
    const merged = new Set<SpendAlertBand>([
      ...readSentBands(monthKey),
      ...bandsRetiredBy(band),
    ]);
    const ledger: SentLedger = { monthKey, bands: [...merged] };
    storage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch (err) {
    // Storage is unavailable; the alert still fired, it just may repeat.
    silentCatch('features/settings/sub_limits/spendAlerts:recordSentBand')(err);
  }
}

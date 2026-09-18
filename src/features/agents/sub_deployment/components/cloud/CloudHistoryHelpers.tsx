import { CheckCircle2, XCircle, Ban, HelpCircle } from 'lucide-react';
import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';

/**
 * The monitor's own closed status vocabulary for a cloud execution row or a
 * trigger firing. The orchestrator's raw strings are mapped here, in ONE
 * table, and an unmapped string lands in a rendered `unknown` — never in the
 * "in flight" glyph. Until 2026-09-07 the fallthrough branch was the in-flight
 * dot, so `error` (which the cloud runner itself treats as terminal,
 * `src-tauri/src/cloud/runner.rs`) and any status a newer orchestrator adds
 * rendered as a run still going. The registry technique is
 * provider-capability-honesty: one canonical set, explicit catch-all to
 * `unknown`, raw string preserved beside it.
 */
export type ExecutionStatusClass = 'completed' | 'failed' | 'cancelled' | 'in_flight' | 'unknown';

const STATUS_CLASS: Readonly<Record<string, ExecutionStatusClass>> = {
  completed: 'completed',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  pending: 'in_flight',
  queued: 'in_flight',
  running: 'in_flight',
};

export function classifyExecutionStatus(status: string | null | undefined): ExecutionStatusClass {
  if (!status) return 'unknown';
  return STATUS_CLASS[status] ?? 'unknown';
}

export function statusIcon(status: string) {
  switch (classifyExecutionStatus(status)) {
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'cancelled': return <Ban className="w-3.5 h-3.5 text-amber-400" />;
    // `LoadingSpinner` renders null, so a queued/running row had NO status
    // glyph at all. The shared liveness dot is the vocabulary for "in flight".
    case 'in_flight': return <LiveStatusDot tone="syncing" size="sm" className="mx-0.5" />;
    // Honest unknown: styled as its own thing, not as failure (false alarm)
    // and not as pending (false calm). The raw string rides along for
    // assistive tech; the expanded row prints it in full.
    default: return <HelpCircle className="w-3.5 h-3.5 text-foreground" role="img" aria-label={status} data-status-class="unknown" />;
  }
}

/**
 * Does this execution belong to the top-error cluster the operator clicked?
 *
 * The stats endpoint groups failures by message and ships each cluster's text
 * back already normalised (and, for a long message, truncated), so an exact
 * equality test would match almost nothing. The cluster and the row therefore
 * match when either string contains the other, case-insensitively - the row is
 * in the cluster whether the panel holds the longer text or the summary does.
 * Only terminally-failed rows are ever in a cluster.
 */
export function matchesErrorCluster(
  exec: { status: string; errorMessage: string | null },
  cluster: string,
): boolean {
  if (classifyExecutionStatus(exec.status) !== 'failed') return false;
  const message = (exec.errorMessage ?? '').trim().toLowerCase();
  const needle = cluster.trim().toLowerCase();
  if (!message || !needle) return false;
  return message.includes(needle) || needle.includes(message);
}

/**
 * Month-to-date spend against the monthly caps the operator actually set.
 *
 * Rolls up only the deployments that BOTH declare a cap and reported a
 * month-to-date figure, and reports how many were left out.
 *
 * `currentMonthCostUsd` arrives from the cloud orchestrator as an optional
 * field, so absent means UNKNOWN, not free. Folding an unreported deployment
 * in at zero would make the card read green while its real burn is unknown -
 * the same total for "no spend" and "no answer". A deployment with no cap is
 * likewise excluded from both sides: charging its spend against a ceiling it
 * does not have would invent a limit.
 *
 * Deliberately NOT derived from the history panel's `stats.totalCostUsd`:
 * that is a 7/30/90-day window while the cap is a calendar month, so the two
 * answer different questions.
 *
 * Returns null when no deployment qualifies - the signal to render no card at
 * all rather than a zero.
 */
export function monthlyBudgetRollup(
  deployments: { maxMonthlyBudgetUsd: number | null; currentMonthCostUsd: number | null }[],
): { spend: number; cap: number; pct: number; unreported: number } | null {
  const capped = deployments.filter((d) => d.maxMonthlyBudgetUsd != null && d.maxMonthlyBudgetUsd > 0);
  const counted = capped.filter((d) => d.currentMonthCostUsd != null);
  if (counted.length === 0) return null;
  let cap = 0;
  let spend = 0;
  for (const d of counted) {
    cap += d.maxMonthlyBudgetUsd as number;
    spend += d.currentMonthCostUsd as number;
  }
  return {
    spend,
    cap,
    pct: cap > 0 ? (spend / cap) * 100 : 0,
    unreported: capped.length - counted.length,
  };
}

/** Stat-card tone for a budget utilization percentage. Named rather than an
 *  inline band table so the boundaries live in one place. */
export function budgetToneForPct(pct: number): 'emerald' | 'amber' | 'red' {
  if (pct >= 100) return 'red';
  if (pct >= 80) return 'amber';
  return 'emerald';
}

/**
 * Straight-line month-end projection of the current month's spend.
 *
 * The cap is a calendar month and the spend is month-to-date, so the figure an
 * operator can still act on is not what has been burned but where the burn is
 * heading. Elapsed fraction is measured in UTC because the backend's
 * month-to-date figure is (`get_all_monthly_spend` starts the month at UTC
 * midnight); mixing a local day count into a UTC total would skew the estimate
 * by up to a day's spend at the month boundary.
 *
 * Deliberately naive - one straight line, no weekday weighting. Anything
 * cleverer would claim a confidence the sample (a handful of days) cannot
 * support. Returns null when the month is too young to divide by: on day one
 * there is nothing to extrapolate FROM, and a projection from a few hours of
 * spend would read as a 30x overshoot.
 */
export function projectMonthEndSpend(spend: number, now: Date = new Date()): number | null {
  const day = now.getUTCDate();
  if (day < 2) return null;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  if (day >= daysInMonth) return spend;
  return (spend / day) * daysInMonth;
}

/**
 * Tone for the budget card once the projection is in hand.
 *
 * Actual overspend still dominates - it has already happened. A projection
 * that crosses the cap while actual spend is calm raises the card to amber and
 * no further: it is an estimate, and painting it red would give a guess the
 * same weight as a fact.
 *
 * The forecast arrives as an ALREADY-DECIDED boolean rather than as another
 * dollar figure, on purpose: a number named `projected` is the same type as a
 * number named `spend`, and a name does not survive an arithmetic operator
 * (golden path: data-provenance-disclosure). A boolean cannot be summed with a
 * measurement by accident.
 */
export function budgetTone(pct: number, paceOverCap: boolean): 'emerald' | 'amber' | 'red' {
  const actual = budgetToneForPct(pct);
  if (actual !== 'emerald') return actual;
  return paceOverCap ? 'amber' : 'emerald';
}

// `timeAgo` hoisted to `@/lib/utils/formatters` (Wave 5 consolidation).
// Note: this file previously used `formatRelativeTime(iso)` with the bare '-'
// fallback — drifted from the other 3 deployment helpers that fell back to
// 'Never'. Fixed to use the canonical 'Never'-fallback variant.
export { formatDuration, formatCost, timeAgo } from '@/lib/utils/formatters';

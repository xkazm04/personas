// The shared vocabulary every Mission Control variant reads its dimensions in.
//
// A Reading is the honest answer to "what does the page know about X right
// now". Three outcomes are kept apart all the way to the pixels:
//   - pending  : the source has not settled yet (a claim would be a guess)
//   - failed   : the source settled with an error and holds nothing usable
//   - ready    : the source settled; `value` may still carry an UNMEASURED
//                quantity (null), which is not the same thing as a zero.
// A Verdict is what a variant draws: the reading folded to one tone.

import type { Tone } from '@/features/shared/components/kit';

export type Reading<T> =
  | { status: 'pending' }
  | { status: 'failed'; error: string }
  | { status: 'ready'; value: T };

/** `yours` = waiting on the operator: info-blue, never the alarm and never the
 *  pink human role (the brief's colour law). */
export type Verdict = 'pending' | 'failed' | 'unmeasured' | 'ok' | 'watch' | 'yours' | 'act';

export const VERDICT_TONE: Record<Verdict, Tone> = {
  pending: 'pending',
  failed: 'neutral',
  unmeasured: 'neutral',
  ok: 'success',
  watch: 'warning',
  yours: 'info',
  act: 'error',
};

/** Severity for sorting and for "where should the eye land": act first. */
export const VERDICT_RANK: Record<Verdict, number> = {
  act: 0, yours: 1, watch: 2, failed: 3, pending: 4, unmeasured: 5, ok: 6,
};

export function verdictOf<T>(r: Reading<T>, judge: (v: T) => Verdict): Verdict {
  if (r.status === 'pending') return 'pending';
  if (r.status === 'failed') return 'failed';
  return judge(r.value);
}

/** A reading from the overview pipeline's own bookkeeping (`pipelineFetchedAt`
 *  / `pipelineErrors`). Data already on screen wins over an error (law 1): a
 *  failed refresh over a warm store stays `ready`. */
export function pipelineReading<T>(
  source: string,
  fetchedAt: Record<string, number>,
  errors: Record<string, string>,
  value: T | null,
): Reading<T> {
  const settled = fetchedAt[source] !== undefined;
  if (settled && value !== null) return { status: 'ready', value };
  if (errors[source] !== undefined) return value !== null ? { status: 'ready', value } : { status: 'failed', error: errors[source]! };
  if (settled && value === null) return { status: 'failed', error: source };
  return { status: 'pending' };
}

export interface DayPoint {
  date: string;
  runs: number;
  failed: number;
  cost: number;
  p95: number;
}

export interface Outcomes {
  /** null = nothing ran in the window: unmeasured, never 0%. */
  successRate: number | null;
  runs: number;
  failed: number;
  points: DayPoint[];
}

export interface Spend {
  total: number;
  /** Per-day burn; null when the backend could not compute it. */
  burnRate: number | null;
  anomalies: number;
  avgLatencyMs: number;
}

export interface AgentHealth {
  score: number | null;
  uptime: number | null;
  critical: number;
  degraded: number;
  healthy: number;
  unknown: number;
  total: number;
}

export interface Recovery {
  open: number;
  paused: number;
  autoFixed: number;
  /** confirmed / attempted from the effectiveness ledger; null = no attempts. */
  holdRate: number | null;
}

export interface Queue {
  reviews: number;
  alerts: number;
  memory: number;
  reports: number;
  total: number;
}

export interface Autonomy {
  /** null = the loop status could not be read. */
  loopOn: boolean | null;
  dispatchedToday: number;
  scheduled: number;
  /** ISO time of the next scheduled run; null = none scheduled. */
  nextAt: string | null;
}

export interface Vault {
  events: number;
  failedRotations: number;
  lastAt: string | null;
}

export interface Instruments {
  sources: number;
  errors: number;
  lastSynced: number | null;
}

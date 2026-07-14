/**
 * Pure window-derivation helpers for the Home landing snapshot.
 *
 * These compute the exact same values the Home Welcome surface derived inline
 * before it rode the Overview spine (useNavCardStatus previously did this on
 * raw `list_all_executions` / `list_events_in_range` payloads it fetched
 * itself). The derivation now lives in the shared `homeSpineSlice` so a single
 * cached fetch serves every Home consumer — but the maths is unchanged, which
 * is why these helpers are extracted and unit-tested in isolation.
 */

export interface Window2 {
  /** Value for the trailing 24h. */
  curr: number;
  /** Value for the 24h before that (prior day) — feeds the trend arrow. */
  prev: number;
}

/** Slim projection of an execution row — only what the windows need. Holding
 *  the full `GlobalExecutionRow` (with input/output blobs) in the store would
 *  bloat it; this keeps the sample cheap. */
export interface RunSample {
  persona_id: string;
  status: string;
  created_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Distinct personas that executed in the trailing 24h (`curr`) vs the prior 24h
 * (`prev`). Rows with an unparseable or future `created_at` are skipped, matching
 * the original inline behavior.
 */
export function computeActivePersonaWindow(
  rows: ReadonlyArray<{ persona_id: string; created_at: string }>,
  now: number,
): Window2 {
  const curr = new Set<string>();
  const prev = new Set<string>();
  for (const r of rows) {
    const ts = Date.parse(r.created_at);
    if (Number.isNaN(ts)) continue;
    const age = now - ts;
    if (age < 0) continue;
    if (age <= DAY_MS) curr.add(r.persona_id);
    else if (age <= 2 * DAY_MS) prev.add(r.persona_id);
  }
  return { curr: curr.size, prev: prev.size };
}

/**
 * Event volume in the trailing 24h (`curr`) vs the prior 24h (`prev`), from a
 * single 48h range fetch partitioned client-side. Everything at/after the 24h
 * cutoff counts as current; everything older (still inside the 48h fetch) counts
 * as prior. Unparseable timestamps are skipped.
 */
export function computeEventWindow(
  events: ReadonlyArray<{ created_at: string }>,
  now: number,
): Window2 {
  const cutoff = now - DAY_MS;
  let curr = 0;
  let prev = 0;
  for (const e of events) {
    const ts = Date.parse(e.created_at);
    if (Number.isNaN(ts)) continue;
    if (ts >= cutoff) curr++;
    else prev++;
  }
  return { curr, prev };
}

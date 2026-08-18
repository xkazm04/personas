---
layer: application
subject: self-healing
technique: effectiveness-accounting
stack: rust
---

# Effectiveness accounting in the Personas healing ledger (Rust)

How this repo realizes the effectiveness-accounting technique: a healing-issue
state machine whose terminal transitions write an auditable outcome ledger, a
deterministic TTL reaper for the in-flight state, CAS transitions that treat a
lost race as an error, and a per-category aggregate the UI reads — plus the one
place the honesty rule is not yet met.

## 1. The state machine, drawn in the source

`src-tauri/db/src/repos/execution/healing.rs:313-351` documents the lifecycle
as ASCII art: `open → auto_fix_pending → resolved` (via `confirm_auto_fix`) or
back to `open` (via `revert_auto_fix_pending` on retry failure, or the TTL
sweeps on staleness). `mark_auto_fix_pending` fires **at schedule time, before
the retry actually runs** (`:385-397`) — the technique's "record the attempt
before applying the fix," so a crashed heal cannot vanish from the record.
`update_status` validates against the closed `VALID_STATUSES` vocabulary and
stamps/clears `resolved_at` in the same statement (`:351-383`).

## 2. Terminal outcomes: confirmed vs reverted, written as audit rows

The engine writes terminal outcomes as audit events under a dedicated
subsystem — `EFFECTIVENESS_SUBSYSTEM = "healing_effectiveness"` with
`EVENT_AUTO_FIX_CONFIRMED` / `EVENT_AUTO_FIX_REVERTED` (`healing.rs:11-18`) —
and the struct doc states the motivation in the technique's own terms: revert
rates were "previously unknowable, since a reverted issue drops back to `open`
and looks identical to a never-attempted one" (`:42-48`). The reverted lane
exists precisely so failure is spelled differently from never-tried.

## 3. CAS transitions: a lost swap is an error

`confirm_auto_fix` updates `WHERE id = ? AND status = 'auto_fix_pending'` and
returns `Err` on zero rows, with the reasoning written at the call: "a LOST
compare-and-swap here IS an error … there is no other racing call that
recorded this same outcome on the caller's behalf, so returning `Err` … is the
only way to surface that the confirm didn't happen" (`healing.rs:401-424`).
`revert_auto_fix_pending` does the same on the failure side (`:428-447`). This
is the upstream source of the technique's "outcome transitions are
compare-and-swap" rule.

## 4. The pending state names its reaper — deterministically

`AUTO_FIX_PENDING_TTL_MINUTES = 10` (`healing.rs:302-311`), enforced twice:
per-persona opportunistically at the start of each healing analysis
(`revert_stale_auto_fix_pending`, `:449-495`) and — the load-bearing half — by
a **global scheduler-driven sweep** (`revert_all_stale_auto_fix_pending`,
`:497-587`) that exists because the opportunistic sweep alone "would leave
issues 'pending forever'" after a crash "then no further failures occur for
that persona" (`:348-350,:497-503`). The TTL exit is its own recorded event
(`event_type='stale_pending_reverted'`, reason `'ttl_exceeded'`), distinct
from an observed retry failure — the technique's reaper rule, including the
distinct spelling.

## 5. The aggregate: per-category rates over a window

`get_healing_effectiveness` (`healing.rs:843-914`) aggregates the terminal
rows over a trailing window (default 30 days, clamped ≥ 1), grouped by the
issue category stored in `detail`, filtered to `EFFECTIVENESS_SUBSYSTEM` "so
it never miscounts unrelated audit noise" (`:11-14`), and returns a ts-rs
exported `HealingEffectivenessReport` — overall plus `by_category:
Vec<HealingStrategyStat>` with `attempted / confirmed / reverted /
success_rate` per cell (`:20-64`) — the per-cell resolution the technique
demands, delivered to the operator surface. `rate()` guards the empty cell
(`:916-923`), and the report carries `window_days`, so the number travels
with (most of) its predicate.

## What to copy, what to improve

Copy: mark-pending at schedule time; the CAS-with-Err transitions and their
comments; the dual (opportunistic + deterministic) TTL sweep with a distinctly
spelled TTL exit; the subsystem-scoped ledger; the per-category report struct
exported end-to-end to the UI.

Improve — three real deviations from the technique:

1. **No unknown lane in the report.** `attempted = confirmed + reverted`
   (`healing.rs:891,:903`): TTL-expired pendings write
   `stale_pending_reverted`, which the aggregate's `event_type IN (?1, ?2)`
   filter excludes — so the unmeasured attempts *vanish from the denominator*
   rather than appearing as an unknown share beside the rate. A strategy whose
   confirmations are unobservable therefore looks identical to one that is
   never attempted, and the success rate silently ranks only the observable.
2. **The grouping key is a free string.** `COALESCE(NULLIF(detail, ''),
   'unknown')` (`:862`) keys cells on whatever the writer put in `detail`,
   not on the closed category vocabulary — one misspelled writer mints a new
   cell, and the 'unknown' bucket conflates empty-detail rows with genuinely
   unknown categories.
3. **Category cells, not strategy × category.** The ledger groups by failure
   category only; which *strategy* produced the outcome (backoff retry vs
   timeout increase vs durable retry-at) is not a dimension, so "backoff
   confirms at 80% on rate limits but timeout-increase only 30% on timeouts"
   is not yet a query the selection tree could consume.

# Athena wake window — accumulate signals, wake on staleness, track impact

> Status: designed + implemented 2026-06-12 (user direction: "she reacts to any
> persona execution and other events — set a configurable timer in Companion
> settings and a queue so she can handle dozens of events after 30/60/120 min").
> Builds on reaction batching (docs/plans/athena-reaction-batching.md).

## Problem

Athena's autonomy is spread over independent tickers that each wake far too
eagerly for unattended operation:

| Surface | Today's wake | Effective eagerness |
|---|---|---|
| Execution triage (`proactive/execution_review.rs`) | event signal per finished execution + **20s quiet debounce**, plus the 5-min proactive tick | a CLI decision after nearly every execution burst |
| Message triage (`proactive/message_triage.rs`) | every proactive tick | ~5 min |
| Channel reactions (`subscription.rs`) | 300s/900s tick (now 1 batched call) | ~5 min |
| Review resolution (same subscription) | same tick, ≤2 calls | ~5 min |

In autonomous mode during a cert run this is dozens of Sonnet calls/hour
reacting to *individual* activity. The batching work fixed the per-call shape;
this fixes the **wake cadence**.

## Design — gate, don't rebuild

**The queue already exists.** Every surface stores its signals durably and
reads them through a cursor (exec/msg cursors in settings, reactions'
per-team last-post cursor, resolutions' once-per-assignment event guard).
Nothing is lost by *not* processing on a tick — signals simply accumulate.
So the design is a shared **gate**, not a new queue:

```
athena_wake_window_minutes (setting, Companion UI):
  0   = reactive (today's behavior; default)
  30 / 60 / 120 = autonomous batch windows

wake_due(surface) =
     oldest_pending_age >= window          // staleness — the user's timer
  OR pending_count >= 25                   // queue-pressure bypass
  OR priority_signal_present               // human-blocking bypass
```

- Each surface keeps its own ticker but asks the gate first; when the gate
  says "not yet", the tick is a cheap SQL no-op and signals keep queueing.
- When due, the surface drains its WHOLE backlog through its existing batch
  call (exec triage ≤24 groups, msg triage ≤20, reactions ≤10 signals, 1 CLI
  call each) — dozens of events, a handful of calls.
- **Priority bypass** keeps autonomy safe: `awaiting_review` cap-outs (team
  hard-blocked on a human) and critical-priority messages do not wait two
  hours. Message triage already force-routes high/urgent to `attention`;
  the gate extends the same doctrine to wake timing.
- **The 20s exec debounce is neutered when a window is set** — the debouncer
  still drains signals (cursor advances stay correct) but does not trigger
  triage; the gated tick owns it.
- Per-surface gating (no central coordinator state) is deliberate: each
  surface's "oldest pending" is already derivable from its own cursor, ticks
  are ≤5 min apart, so surfaces converge on the window within one tick of
  each other. No new cross-surface state to corrupt.

## Impact tracking — `athena_wake_log`

One row per actual wake (not per skipped tick):

```sql
CREATE TABLE athena_wake_log (
  id              TEXT PRIMARY KEY,
  surface         TEXT NOT NULL,   -- exec_triage|message_triage|channel_reactions|review_resolution
  trigger_reason  TEXT NOT NULL,   -- window|queue_size|priority|reactive
  signals_pending INTEGER NOT NULL DEFAULT 0,
  oldest_age_min  INTEGER NOT NULL DEFAULT 0,
  cli_calls       INTEGER NOT NULL DEFAULT 0,
  actions_taken   INTEGER NOT NULL DEFAULT 0,  -- posts/resolutions/attention-flags/digests
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

This is the "track impact of the autonomous mode" surface: per-day wakes,
signals handled, CLI calls, and actions — the denominator the BYOM v2 routing
decision needs (how many of these calls are simple enough for the local
model), and the evidence for tuning the window.

## Companion settings UI

In the Companion panel's settings surface: an **Autonomy cadence** block —
a 4-option selector (`Reactive` / `30 min` / `1 h` / `2 h`) writing
`athena_wake_window_minutes`, plus an impact strip for the last 24 h
(wakes · signals · CLI calls · actions) fed by a `companion_wake_stats`
command aggregating `athena_wake_log`.

## Out of scope (follow-ups)

- Proactive *nudges* (goal/backlog/ritual triggers) keep their own budget
  system (3/day cap) — they are user-facing pings, not CLI work, and already
  have spam control.
- Routing the batched wake calls to the local model (BYOM v2 Simple routing)
  — the wake log's call counts justify and size that work.
- A unified cross-surface "one wake, one combined prompt" — only worth it if
  the wake log shows surfaces routinely waking together with small batches.

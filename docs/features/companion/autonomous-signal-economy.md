# Autonomous signal economy — gap analysis & architecture

**Status:** shipped 2026-06-10 (execution triage redesign + message triage v1).
**Problem statement (from live use):** in autonomous mode Athena was "very
inefficient in deciding when to report to the user and when to quietly process"
— the chat filled with `[proactive: execution_review]` turns whose entire
content was "No response requested.", each wearing full recall chrome ("Athena
replayed 20 recent turns and consulted 9 memories"), while genuinely important
findings had no privileged channel. The design target: **hundreds of executions
per minute can flow through her; only aggregated, important signal may reach
the user.**

## Gap analysis (what was wrong before)

| # | Gap | Mechanism | Consequence at volume |
|---|-----|-----------|----------------------|
| 1 | **Per-execution chat turns** | `execution_review.rs` spawned a full `TurnOrigin::Proactive` CLI turn per candidate (≤2/tick + the debounced event leg) | Every flagged run cost a full system-prompt build (constitution + observability + episodic recall) and ~$0.90/turn; the chat became a review log |
| 2 | **No quiet outcome** | The directive licensed "say so in one line and stop", but the turn had ALREADY persisted its `[proactive: …]` system episode, and the one-liner persisted as an assistant episode | "No response requested." × dozens — and `brain/episodic.rs` episodes are **append-only by design** (the no-data-loss guarantee), so the noise is permanent. The fix has to be *don't mint turns for chatter*, not *delete them after* |
| 3 | **Recency-not-importance selection** | `MAX_REVIEWS_PER_TICK = 2`, newest-first, cursor advances past the whole window | Under load, the 2 reviewed runs were arbitrary; everything else was silently skipped — the opposite of triage |
| 4 | **No aggregation** | Each candidate reviewed in isolation | 14 identical PAT failures = 14 candidates fighting for 2 slots, never "one pattern, count 14" |
| 5 | **No severity / notification policy** | Every review landed identically in chat; nothing distinguished "FYI" from "you must look today" | The user had to read everything to find anything; real escalations had no privileged channel |
| 6 | **Quiet hours not honored** | Exec reviews bypassed `proactive::quiet` entirely | Machine-cadence output at 3am |
| 7 | **No format contract** | The directive asked for analysis, not a shape | Verbose essays for findings that needed two sentences and an action |
| 8 | **Messages surface untouched** | Athena autonomously resolves human reviews (approve/incident/escalate) but had NO procedure for `persona_messages` | The Overview → Messages inbox accumulated unread operational chatter with no triage, summarization, or escalation |

## Architecture (what ships now)

One principle, two legs: **a cheap headless decision is the gatekeeper; chat
and notifications are budgets it spends, not defaults.** Both legs reuse the
`athena_reaction::cli_text` subprocess pattern (sonnet, standalone prompt, no
session, zero episodes) and its tolerant brace-matching protocol parsers.

```
signals (exec finishes / unread messages)
   │  cursor-windowed scan + Rust-side grouping/batching
   ▼
ONE headless triage decision per pass        ← cheap, silent, auditable (tracing)
   │
   ├── drop / done   → nothing surfaces (tracing; messages get an audit annotation)
   ├── digest        → ONE aggregated ProactiveCard per hour bucket
   └── deep_dive /   → the ONLY tier that spends chat (≤1 turn/batch, format
       attention       contract) or a desktop notification (quiet-hours guarded)
```

### Leg 1 — execution triage (`proactive/execution_review.rs`)

- Scan all terminal executions since `companion_exec_review_cursor` (window
  cap 200, batch cap 24 — overflow is **counted and printed on the digest**,
  never silently dropped).
- Group by `(persona, flag-reason)` with count + combined cost + newest
  exemplar (error tail). Failures order first, then expensive, then slow.
- One decision: per-group `drop | digest | deep_dive` + batch `headline` +
  `escalate_to_user`.
- Apply: digest lines → `execution_review` card (`trigger_ref =
  bucket:<UTC hour>` — at most one pending card per hour, floods aggregate);
  ≤1 deep-dive → `spawn_proactive_turn` with a **format contract** (lead with
  a one-line verdict, ~120 words unless proposing an op, license to stop in
  one line); escalation → `notifications::send`, suppressed in quiet hours.
- Worst-case chat volume drops from 2 turns/tick of mostly-noise to ≤1
  pre-screened substantive turn per batch; everything else aggregates onto
  cards or stays in tracing.

### Leg 2 — message triage (`proactive/message_triage.rs`)

The Messages counterpart of Athena's human-review resolution
(approve/incident/escalate → here done/digest/attention):

- Gated on `autonomous_message_triage` (settings key, default **off**) on top
  of `companion_autonomous_mode`. Flip live in the DB like the other
  `autonomous_*` keys.
- Cursor `companion_msg_triage_cursor` advances **only past the processed
  batch** (oldest-first, 20/tick ≈ 240/hour) — a backlog drains instead of
  being skipped. First enable seeds to "now": no retroactive mass-read of the
  historical pile.
- Verdicts: **done** → `mark_as_read` + `athena_triage` audit annotation
  merged into the message's `metadata` JSON (action/note/timestamp — "why is
  this read?" is always answerable); **digest** → summarized into the card,
  then marked read (same annotation); **attention** → stays UNREAD, listed on
  the card with the "why you" note, desktop notification (quiet-hours
  guarded).
- **Code-level safety floor** (`effective_action`): `high|urgent|critical`
  priority can never be auto-resolved — forced to `attention` regardless of
  the model's verdict. Unknown verdicts fail safe to `attention`; verdict-less
  messages stay unread untouched.
- Card: `message_digest` kind, hour-bucketed dedupe, body = batch summary +
  "Needs your personal read" lines + audit counts. Engage lands on
  **Overview → Messages**.

### Failure modes, chosen deliberately

- **CLI error** → `Err` propagates, cursor NOT advanced (exec leg advances on
  scan, see below), retried next pass.
- **Unparseable decision (messages)** → batch skipped, cursor advanced,
  messages simply stay unread — the safe direction. Prevents a poison batch
  from livelocking the tick.
- **Digest dedupe hit** → the card for that hour already pending; lines are
  logged, items were still annotated/marked correctly. Cards are pointers, the
  durable state lives in Messages/Executions.
- **Exec cursor semantics unchanged** (advance past the scanned window even if
  triage later fails): bounds work, never re-reviews; the trade is a missed
  batch on CLI failure, same as before.

## Future work (known, not yet built)

- ~~**Decision-queue source for attention messages**~~ — **SHIPPED (C1).**
  Each `attention` message triage now also enqueues a `message_attention`
  proactive (no budget cost, deduped by message id, via `enqueue_external` +
  `deliver_now`). `useDecisionQueue` maps those into the hands-free decision
  queue as a fourth source (after incidents): options are **Open** (→ Overview
  → Messages + engage), **Mark read** (`mark_message_read` + engage), and
  **Dismiss** (the message stays unread). The aggregated digest card is
  unchanged — this is the per-item "needs your read" decision.
- ~~**Per-source attention budgets**~~ — **SHIPPED (C2).** The single daily cap
  of 3 (too coarse, every kind shared it) is now a **global ceiling of 12** with
  **per-trigger-kind sub-budgets** underneath (`execution_review`/`message_digest`
  4, `incident_blocker` 6, `message_attention` 8, `dev_goal_*` 2,
  `athena_scheduled` unthrottled, fallback 3). `budget::try_consume(kind)` claims
  one global unit AND one per-kind unit atomically (rolls back the global
  increment if the per-kind cap blocks), counted in `companion_attention_budget`.
  A noisy leg now exhausts only its own sub-budget. (Live-tuning overrides + an
  A4 per-kind display are a follow-up.)
- ~~**Severity registry**~~ — **SHIPPED (D1, direction 3).** Execution triage now
  flags deviation from each persona's *own* learned norm, not the global
  `EXPENSIVE_USD`/`SLOW_MS` constants. `proactive/baselines.rs` computes p50/p95
  of cost + duration per persona over a trailing 30 days (cap 500 rows, `n ≥ 8`
  or it keeps the global fallback), caches them in `companion_persona_baseline`
  (lazy 24h refresh, only for personas in the current scan batch), and flags
  `expensive`/`slow` at `max(floor, 1.5 × p95)`. `declared_cost_usd` /
  `declared_duration_ms` columns let the user's word override the learned p95
  (no UI yet — settable via the DB). Digest exemplar lines now read
  "3.2× this persona's typical p95 of $0.41" so the verdict is concrete.
- ~~**Daily rollup**~~ — **SHIPPED (C3).** `proactive/rollup.rs` emits one
  `daily_rollup` ProactiveCard per local day (gated by `companion_daily_rollup`,
  default off; fires at/after `companion_daily_rollup_hour` default 18, once per
  day via `companion_daily_rollup_last`). Body is composed deterministically (no
  model call) from the `companion_turn` ledger (turns + cost + triage verdict
  sums + parse failures), the proactive table (cards created/engaged/dismissed),
  and job failures — counts only, each line naming where to look. No budget cost
  (`enqueue_external`), deduped on the date. Checked from both proactive
  evaluation entry points (manual + desktop tick).
- **Exec-leg retry cursor** — a two-phase cursor (scanned vs triaged) so a CLI
  failure doesn't skip the batch.

## Related

- [`README.md`](./README.md) — companion overview (signal-economy section).
- [`athena-decision-layer-plan.md`](./athena-decision-layer-plan.md) — the orb
  decision bubble this feeds (P3).
- `src-tauri/src/companion/athena_reaction.rs` — the headless-decision pattern
  both legs reuse (channel reactions + review resolution).
- `docs/tests/athena/autonomous-mode-direction.md` — the original Goal 1/2
  design this supersedes in part.

# Autonomous mode — reality vs your three goals, and which way to bend it

**Date:** 2026-05-27. Supersedes the speculative parts of `autonomous-mode-analysis.md` with a code-verified map.

Your stated goals:
1. **Event-driven:** listen to app events (finished executions) → analyze the run → propose improvements.
2. **Self-initiated:** from its own will, analyze recent executions → propose improvements.
3. **Autoapproval.**

The headline: **the app already has two separate "autonomy" subsystems, and *neither* does what you want.** Your three goals all need a third capability that doesn't exist yet — but it's a small bridge on top of machinery we just hardened, not a new system.

---

## The two systems that exist today

### A. Autonomous chains (`continue_autonomously`)
- **Entry point:** ONLY Athena emitting `OP: continue_autonomously` at the end of a turn. That requires a turn to already be running — which requires a **user message**. `TurnOrigin` is exactly `{ User, Autonomous{chain_index} }`. There is no other way to start a turn.
- **Mechanics:** 15s delay, 20-chain cap, cancel-on-user-message. Runs a real `send_turn` (full LLM reasoning, dispatcher, episodes). We hardened this over the last sessions.
- **What it is:** "keep working on the thing the user just asked." **It cannot start on its own.**

### B. Proactive nudges (`proactive/` + 5-min scheduler)
- **Entry point:** a tokio task in `companion_init` ticks every **5 minutes** (`PROACTIVE_TICK_INTERVAL`), runs `triggers::collect_all`, plus `schedule_proactive` time-released commitments.
- **What the triggers cover:** brain state (`goal_target_approaching`, `backlog_aging`, `cadence_due`, `on_this_day`, `ambient_match`) and **Claude Code fleet CLI sessions** (`fleet_failed`, `fleet_stale`, `fleet_awaiting`, `fleet_session_stuck`) — i.e. sessions *Athena spawned*, not your persona executions.
- **What a trigger produces:** a **pre-drafted `Nudge` string** from a pure Rust function. It is persisted, budget-gated (3/day), quiet-hours-gated, emitted on `companion://proactive`, and shown as an "Athena reached out" card. **The user must *engage* the card to get a real Athena turn.** The nudge itself contains zero LLM reasoning — it's a deterministic template.

**The gap both systems share:** nothing wakes Athena to *reason* about an event. B notices things but only emits a canned string; A reasons but only when the user starts it.

---

## Goal-by-goal: reality vs intent

### Goal 1 — finished executions → analyze + propose improvements
**Reality:**
- Persona executions finish in the engine (`engine/mod.rs` → `notify_execution_completed`). That fires **desktop notifications**, not anything the companion subscribes to. Grep confirms **no companion subscription to any execution event.**
- The proactive triggers don't read the `executions` table at all (they read brain state + fleet CLI sessions).
- So today: an execution finishing produces **nothing** in Athena's world.

**Difference from your goal:** total. There's no event bridge, and even if there were, the proactive path would emit a canned string, not an analysis. "Analyze the run + propose improvements" *requires a real reasoning turn*, which only A can do, and A can't be triggered by an event.

### Goal 2 — self-initiated analysis of recent executions
**Reality:**
- The 5-min proactive tick is the only "from its own will" engine. It's the right heartbeat — but its triggers don't cover executions, and they emit strings, not analysis.
- The autonomous addendum *mentions* "during idle autonomous ticks … `athena-backlog-scout`" — but there is **no idle entry point**. Autonomous mode never self-starts. That sentence is aspirational.

**Difference from your goal:** the heartbeat exists; the execution-scanning trigger and the "spawn a real analysis turn instead of a string" step do not.

### Goal 3 — autoapproval
**Reality:**
- Every Athena `propose_action` → approval card → **user click**. No autoapprove anywhere in the companion path. Autonomous mode does **not** change approval behavior — it only enables `continue_autonomously` and cancels the pending tick on toggle-off.
- There *is* a precedent to mirror: the **engine** auto-resolves persona *Human Reviews* via a `trust_llm` / `auto_triage` policy (`engine/dispatch.rs:624` — `auto_resolved`, notes "auto-approved by trust_llm policy"). That's a different surface (persona runs, not Athena chat) but it's the exact pattern to copy.

**Difference from your goal:** no autoapprove for Athena's cards. The pattern to clone already lives in the engine.

---

## The direction: don't build a third system — add entry points to A, gated by a policy

The autonomous **turn machinery** (A) is solid and just hardened (OP-emission, Phase-2 self-correction, clean strip, job capture). The proactive **heartbeat + event awareness** (B) is the right place to detect "something happened." The move is to **let B spawn a real A-style reasoning turn**, plus add an autoapprove policy for Goal 3.

Three concrete pieces:

### Piece 1 — a new turn origin: `TurnOrigin::Proactive { trigger_kind, trigger_ref }`
A reasoning turn that isn't user-started and isn't a chain-continuation. It reuses `send_turn` wholesale (same dispatcher, episodes, autonomous addendum) but with a synthetic prompt built from the trigger. Example prompt for Goal 1:
> *"Execution `<id>` of persona `<name>` just finished with status `failed` in 4.2s. Here is its output/error: `<tail>`. Analyze what happened and, if there's a concrete improvement, propose it (a prompt tweak, a tool/guardrail, a model-tier change). If it ran clean and there's nothing to add, say so in one line and stop."*

This is the single keystone. Once it exists, both Goal 1 and Goal 2 are just *who calls it*.

### Piece 2 — two callers feeding Piece 1
- **Goal 1 (event-driven):** a companion subscriber on execution completion. Cleanest hook: tap the same point as `notify_execution_completed` in `engine/mod.rs`, or subscribe via the event bus, and — **only when autonomous mode is on** — enqueue a `Proactive{execution_review, <exec_id>}` turn. Debounce/batch so a burst of executions doesn't spawn 20 turns (e.g. one turn per execution, capped per window, or batched "3 runs just finished").
- **Goal 2 (self-initiated):** extend the existing 5-min proactive tick with an `execution_review` trigger that scans recent executions (failed / regressed / anomalous-cost) since the last tick and — when autonomous mode is on — spawns a `Proactive{...}` *turn* instead of a nudge string. Budget-gate it (reuse `budget.rs`) so it can't spam.

The autonomous-mode toggle becomes the master switch: **off** = today's behavior (proactive nudges only, user engages); **on** = proactive triggers and execution events spawn real reasoning turns that can propose actions.

### Piece 3 — scoped autoapprove policy (Goal 3)
Mirror the engine's `trust_llm` precedent, but **scoped by action kind**, because "autoapprove everything" is how an autonomous agent does real damage. Proposed default tiers:
- **Auto-fire already (no change):** reads (`use_connector` read caps, `show_*` cards, `open_route`). These never needed approval.
- **Autoapprove when autonomous-mode + policy on:** memory writes (`write_fact`, `write_backlog_item`), `enqueue_dev_job` scans, `schedule_proactive`. Low blast radius, reversible.
- **ALWAYS keep gated (even in autonomous mode):** external writes (`use_connector` write caps — Gmail send, Discord post), destructive DB mutations, `build_oneshot`/`prefill_persona_create` (creates real agents), `assign_team`. These touch the outside world or create durable state.

Implementation: a `companion_autoapprove_policy` setting (per-action-kind allowlist) + a check in the dispatcher's approval path that, when the action kind is on the allowlist AND autonomous mode is on, resolves the approval immediately (status `auto_approved`, note the policy) instead of leaving it `pending`. This reuses the exact `execute_*` handlers the manual click already calls — so "autoapprove" is just "click it programmatically under policy," which is precisely what the test harness already proves works end-to-end.

---

## Which way to bend — my recommendation

Build **Piece 1 + Goal 2 first** (self-initiated execution review via the 5-min tick), because:
- It reuses the existing heartbeat — no new event-subscription surface to get wrong.
- It's rate-limited by construction (5-min tick + budget), so the blast radius during bring-up is tiny.
- It exercises the keystone (`TurnOrigin::Proactive`) end-to-end before we wire the higher-frequency event path.

Then **Goal 1 (event-driven)** once the turn-spawn is proven — it's the same turn, just a faster, debounced trigger.

Then **Goal 3 (autoapprove)** last and most conservatively — ship it with ONLY the low-blast-radius tier auto-approving, external/destructive always gated, and watch a few real autonomous sessions before widening.

This order means each step is testable in isolation and the dangerous capability (autoapprove of writes) comes last, after we trust the reasoning.

---

## How to test (extends the harness we just built)

A new fixture `autonomous-exec-review.json`, driven by the same two-pass runner, with three new harness primitives:

1. **Seed a synthetic execution.** A bridge method that inserts a fake finished execution row (one clean, one failed-with-error, one slow/expensive) so the trigger has something to find — deterministic, no real persona run needed.
2. **Force a proactive tick.** Reuse/extend `companion_evaluate_proactive_now` to run the tick synchronously and, with autonomous mode on, spawn the review turn. Capture the resulting turn as a normal bundle.
3. **Assert the analysis turn.** New axes/asserts:
   - A `Proactive`-origin turn was produced (not a nudge string) — check episode origin.
   - The reply **references the specific execution** (id/persona/status/error tail) — grounding, no hallucinated runs.
   - On the failed run, it **proposes a concrete improvement** (an OP or a named change), not generic "looks fine."
   - On the clean run, it **stops** (one-line "nothing to add") — no manufactured work.
   - **Autoapprove scoping:** a proposed `write_fact` auto-resolves; a proposed external write (Gmail send) stays `pending`. Assert both.
   - **Budget/rate:** N executions in one window produce ≤ budget turns, not N.

Scenarios mirror the goals: clean-run-no-op, failed-run-proposes-fix, expensive-run-flags-cost, burst-of-runs-batched, autoapprove-allowlist-honored, destructive-still-gated, cancel-on-user-message-mid-review.

---

## Open decision for you

The one real judgment call is **autoapprove aggressiveness** — see the question I'll ask. Everything else follows the recommended order above.

---

## Build log — Increment 1 shipped + smoke-tested (2026-05-27)

Decisions taken: **Goal 2 first**, **conservative autoapprove** (deferred to Increment 2).

**Shipped (compiles clean, 106/106 companion tests pass):**
- **Keystone** `TurnOrigin::Proactive { trigger_kind, trigger_ref }` in `companion/session.rs` + `pub fn spawn_proactive_turn(...)` (blocking-thread + current-thread runtime, mirrors `schedule_autonomous_tick` for the `!Send` send_turn). Opening episode persists as `System` `[proactive: <kind>]`; a proactive turn that emits `continue_autonomously` starts its own chain.
- **Server-side autonomous flag** — `companion_set_autonomous_mode` writes `companion_autonomous_mode` settings row; header toggle calls it; `autonomous_mode_enabled(&db)` is the scheduler's read path (frontend Zustand isn't visible backend-side).
- **Goal 2 reviewer** — `companion/proactive/execution_review.rs`: scans `persona_executions` (failed / slow ≥120s / expensive ≥$0.50) after a settings cursor, builds a grounded directive, spawns a Proactive turn per qualifying run (cap 2/tick), advances the cursor past the window. Wired into the 5-min proactive tick, gated on `autonomous_mode_enabled`.
- **On-demand trigger** — `companion_review_recent_executions_now` (returns count spawned) for tests + a future "review my recent runs now" button.
- **Cursor key** `companion_exec_review_cursor` allowlisted in `settings_keys` (a real bug caught in testing: a non-allowlisted key makes `settings::set` reject it, so the cursor never persists and the reviewer reseeds to "now" every tick → silently reviews nothing).

**Smoke test (real executions, autonomous on):** set cursor before a window of real runs → `companion_review_recent_executions_now` returned **2** → two `[proactive: execution_review]` turns persisted. The analysis was grounded and sharp: Athena identified the failed runs as a single app-restart orphaning three in-flight executions ("killed within 3ms of each other"), cited the specific execution ids/timestamps/cost, correctly said "nothing to fix on the persona here," and pointed at the real bug. Re-running returned **0** (cursor-advance dedupe works; no history backfill). **Goal 2's backend path is proven end-to-end.**

**Gap found — frontend doesn't surface backend-initiated turns live.** `companionWaitForTurnFinish` returned `sawStreaming:false`: the panel sets `streaming`/refetches the transcript only in the *user-send* path, so a proactive turn streams + persists but the new assistant bubble doesn't appear until a refetch. Tracked as the next piece (task: "surface backend-initiated turns live"). The turn is real and persisted; it's just invisible in-panel until the stream handler learns to handle turns this client didn't initiate.

**Still ahead:** (1) frontend live-surfacing of proactive turns; (2) full two-pass `autonomous-exec-review.json` fixture (synthetic-execution seeding needs an app-side insert path — the `persona_executions` FTS triggers block external `sqlite3` CLI inserts; the smoke test sidestepped this by reviewing *real* runs via a past cursor); (3) Goal 1 (execution-finished event subscriber → debounced Proactive turn); (4) Increment 2 conservative autoapprove.

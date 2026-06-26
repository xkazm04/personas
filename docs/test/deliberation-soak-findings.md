# Deliberation soak — findings & efficiency tuning

Hands-free soak of the autonomous team-deliberation flow, driven by
[`scripts/test/deliberation-soak.mjs`](../../scripts/test/deliberation-soak.mjs)
against the running app's test-automation bridge (`:17320`). The harness
resumes-or-creates a deliberation, **auto-confirms every capability approval** so
the team can actually work, exercises splits/merges, auto-resolves escalations,
and records flow metrics to `scripts/test/.soak/` (git-ignored).

## Wave 1 — Haiku moderator (baseline)

Team **SDLC — ai-bookkeeper**, topic "Is the app ready for production?" (+ 4
rotating prod-readiness variants), unlimited budget, 240 min.

| Metric | Value |
| --- | --- |
| Deliberations resolved | 16 / 16 (0 aborted) |
| Moderated rounds | 49 |
| Messages (turns) | 590 |
| Capability **requests** (⏸) | 151 |
| Approvals that spawned (▶) | 60 |
| Approvals that **failed to even run** (⚠) | 29 |
| Capability **outputs delivered** (🛠) | 19 |
| **Request → usable-output yield** | **13%** |
| Escalations / wrap-ups | 22 / 6 |
| Splits / merges | 7 / 8 |
| Cost | $6.83 (~$1.7/h) |
| Errors | 0 |

Per-capability: Security Scan 50→9, **Release Automation 43→0**, Architecture
Review 21→6, Code Review 20→3, Backlog Scan 7→0.

### Diagnosis — high talk, low yield

The flow *runs* (0 errors, 100% resolved, cost fine) but is inefficient at the
thing that matters: turning requests into real data the team builds on. Five
problems:

1. **Deliberations resolve before requested work returns** — of 60 spawned, only
   19 (32%) posted output; the rest were still running when the deliberation
   converged/escalated. The team pays for a code review, then ships a verdict
   without reading it.
2. **~33% of approvals can't even run** (29 ⚠) — personas request capabilities
   whose connectors aren't set up; the `needs_credentials` gate rejects them.
3. **Re-request storms** — 151 requests but only 89 distinct approvals; personas
   re-ask for the same capability round after round.
4. **A capability that always fails** — Release Automation, 43 requests / 0
   outputs — pure waste.
5. **Premature, shallow resolution** (avg 0.76 rounds; 22 escalations) — often
   escalating *while blocked on data that never arrived*.

## Fixes (all five) + Opus moderator

Shipped in the engine ([`src-tauri/src/engine/deliberation.rs`](../../src-tauri/src/engine/deliberation.rs)):

1. **Block convergence/escalation while a result is undiscussed.**
   `build_moderator_context` sets `result_pending` when the newest turn is a 🛠/⚠
   result; `plan_transition` then suppresses converge/conclude/escalate (and
   resets the stall counter) for one forced reaction round (the round-cap backstop
   still applies). The tick routes a fallback speaker so the round isn't empty.
2. **Pre-flight capability offering** — a persona with `setup_status =
   needs_credentials` is offered **no** capabilities, so it stops requesting
   unrunnable ones (kills the 29 ⚠).
3. **De-dupe requests** — the turn prompt lists capabilities **already run /
   attempted / requested** this deliberation, and a request that matches one is
   dropped. Subsumes the Release-Automation-always-fails case (it's attempted
   once, then never re-requested).
4. **Escalation is outstanding-work-aware** — `result_pending` resets the stall
   counter and the moderator is told "never declare stuck while a result just
   landed", so the team stops escalating when it actually has fresh data.
5. **Output-yield metric** — the harness now reports `outputYield`
   (`turnOutputs ÷ turnRequests`) per wave, so this degradation is visible.

**Moderator promoted Haiku → `claude-opus-4-8`** (`MODERATOR_MODEL`) — a more
capable conversation manager, to measure how far efficiency goes with the fixes
*and* a stronger orchestrator. (Reasoning effort isn't exposed on the headless
`claude -p` path, so it runs at default.)

## Wave 2 — Opus moderator + all 5 fixes (different project)

Team **SDLC2 — Grant Writing**, same prod-readiness questions, unlimited budget.
14 deliberations (13 resolved) before the host machine slept overnight and wedged
the harness on a hung call (a harness bug — no client-side `fetch` timeout / hard
wall-clock kill — *not* an engine fault; engine logged 0 errors).

| Metric | Wave 1 (Haiku, baseline) | Wave 2 (Opus + fixes) | Change |
| --- | --- | --- | --- |
| Request → output **yield** | 13% | **76%** | ~6× |
| Capability failures (⚠) | 29 | **0** | eliminated |
| Requests / delib | 9.4 | 2.1 | ~4× fewer (de-dup) |
| Reap rate (output returned) | 30% | **96%** | work no longer wasted |
| Escalations / delib | 1.4 | 0.15 | ~9× fewer |
| Rounds / delib | 3.1 | **9.0** | deeper deliberation |
| Cost / delib | $0.43 | $2.62 | ~6× (Opus) |

**Read:** the structural wins trace to the fixes (de-dup → fewer requests;
pre-flight → 0 failures; result-gating → 96% reap + near-zero escalations); Opus
adds depth (3× more rounds, sharper routing). The one real cost is the ~6×
per-deliberation Opus tax on the moderator. Combined generalization test (new
team + new domain + Opus + fixes), not a controlled A/B — but the structural
metrics are mechanism-driven, not domain luck.

**Harness follow-up:** add a client-side `fetch` timeout + an absolute
wall-clock kill so a sleep/hung-call can't overrun the budget (Wave 2 ran ~7h40m
wall vs the 240-min cap because the loop wedged after the machine slept).

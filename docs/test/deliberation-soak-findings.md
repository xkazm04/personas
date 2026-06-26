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

**Harness follow-up (done):** client-side `fetch` timeout + an absolute
wall-clock kill so a sleep/hung-call can't overrun the budget (Wave 2 ran ~7h40m
wall vs the 240-min cap because the loop wedged after the machine slept).

## Wave 3 — per-checklist-item parallel split (Opus, 1 h)

Same team/questions, but the split planner now makes **one track per independent
checklist item** (2–6 tracks) and the harness splits early (≥2 items at round ≥1),
so the team works the whole checklist in parallel. 60-min cap, hard-killed cleanly
at 60.0 min (no overrun — the hardening works).

Example resolved deliberation, "Is the app ready for production?":

| Track (checklist item) | sub-team | rounds | cost | outcome |
| --- | --- | --- | --- | --- |
| Blocking vs. non-blocking gaps | 4 | 11 | $2.99 | resolved |
| Named launch criteria & acceptance bar | 3 | 5 | $1.75 | resolved |
| (parent merge) | — | — | $0.39 | resolved |

| Metric | Wave 1 (Haiku) | Wave 2 (Opus, grouped) | Wave 3 (Opus, per-item) |
| --- | --- | --- | --- |
| Output yield | 13% | 76% | **100%** (4/4) |
| Failures / escalations | 29 / 22 | 0 / 2 | **0 / 0** |
| Cost / deliberation | $0.43 | $2.62 | **~$5.1** (real) |
| Throughput | ~4/h | ~3.5/h | **~1.5/h** |

**Read:** per-item split is the **quality ceiling** — every request delivered,
zero failures, zero walls; each item got a focused sub-team that worked it to the
depth it needed (11 rounds vs 5). The flip side: **each item becomes a full Opus
sub-deliberation**, so cost multiplies (~12× the Haiku baseline) and throughput
drops to ~1.5 deliberations/h. Lever: per-item + Opus for exhaustive
high-confidence coverage; grouped split or a cheaper track-moderator for
throughput/cost.

**Harness metric note (fixed):** a split deliberation's cost was undercounted —
the harness read only the parent's `costSpentUsd`, not the tracks' (each track is
a separate deliberation). It now sums track costs into the per-deliberation total.

## Wave 4 — judge fixes + cost lever (Opus parent / Sonnet tracks, 1 h)

Three judge fixes (group-scoped capability de-dup, within-deliberation
stale-revalidation, bias-to-act) + the moderator cost lever. Clean 60-min run.

| Metric | W1 Haiku | W2 Opus grouped | W3 Opus per-item | **W4 fixes** |
| --- | --- | --- | --- | --- |
| Output yield | 13% | 76% | 100% | **100%** |
| Failures / escalations | 29 / 22 | 0 / 2 | 0 / 0 | **0 / 0** |
| In-group duplicate runs | high | some | **yes** (parent+track) | **0%** |
| Cost / deliberation | $0.43 | $2.62 | ~$5.1 | **~$3.5** |

**Read:** the fixes hold — **0 duplicate runs**, 100% yield, 0 failures, 0
escalations, and each capability ran exactly once per deliberation (no
re-validation loops, no announce-spin). Cost/deliberation fell vs the per-item
wave because the fixes made deliberations **more focused** — they converged
single-thread and **did not split** (0 splits this wave), so the Sonnet-track
cost lever and cross-track de-dup weren't exercised here (they're covered by unit
tests + Wave 3's duplicate evidence). Splitting is sampling-dependent (Wave 3 on
the same team/questions split into 2 tracks; Wave 4's three questions each
converged before the agenda grew to the ≥2-open-item split threshold). Net: the
efficiency pillar is now clean for the common single-thread path; a split-heavy
run is still the way to measure the Sonnet cost lever directly.

**Remaining follow-up:** full result-*content* sharing across tracks (beyond the
"already ran" titles) is limited by the 240-char per-turn context truncation — the
deeper improvement once split-heavy runs warrant it.

## Wave 5 — split-forced (5-area audit, Opus parent / Sonnet tracks, 1 h)

A fixed 5-area question (`TOPIC` env) forced splits every time: 3 deliberations,
**all split** into per-area tracks (3 / 6 / 5 tracks), 3 merges, 63 rounds, 0
errors. Sonnet tracks cost $0.19–$1.58 each (vs Opus tracks $1.75–$2.99 in W3) —
**cost lever confirmed**; ~$4.3/deliberation.

**Quality (judge read of a full split transcript): strong.** The capability
outputs are real and decision-useful — a v0.35.0 Security Scan (0 Crit/High, 3
MED + 9 LOW, file:line, ship verdict, DB-migration blockers), ADR 0042
(SHIP verdict + PR triage + task breakdown), a Code Review (APPROVE, auth
boundaries verified line-by-line). Each track resolved to a concrete proposal.
Cross-track de-dup mostly held — tracks built on the parent's scans instead of
re-running them.

**But dead-spending is reduced, not eliminated** (the bar for days-of-autonomy):
1. **Result-CONTENT sharing gap (personas explicitly hit it).** A track's Security
   Sentinel: *"The On-Demand Security Scan is already in ALREADY RUN — but its
   output wasn't surfaced in this thread … someone needs to post the actual
   findings here."* The de-dup tells a track *that* a capability ran but not
   *what it found* (truncation + cross-deliberation). They cope via memory, but
   it's real friction. **#1 remaining fix.**
2. **Announce-but-never-run loop persists.** A track announced `uc_bug_hunt` 4×
   (an unavailable capability) without it ever running; two turns near-verbatim.
   The bias-to-act rule reduced but didn't kill it — the moderator kept routing
   for it. Needs a hard "after one unfulfilled/unavailable attempt, stop routing".
3. **Duplicate runs down to ~20%, not 0** — Architecture Review ran 2× in two
   groups: a parallel-track race (concurrent tracks request the same capability
   before either's result posts). Needs an **approval-time** atomic group de-dup.
4. **Empty rounds** — one track logged 11 rounds but 3 turns (~8 produced no
   turn). Routing/forced-reaction rounds that yield nothing.
5. **Pre-flight miss** — Release Automation was requested then failed (`⚠`
   connector not set up); the persona then said "already ran" and tried again.
   Pre-flight only filters `setup_status=needs_credentials`, not runtime-unavailable.

**Verdict:** quality pillar is there; the efficiency/no-dead-spending pillar needs
one more round — chiefly (1) result-content sharing, (2) approval-time de-dup, (3)
a hard unavailable-capability stop. (Harness note: with no active deliberation
cleared, the wave resumed leftover deliberations and mislabeled their topic as the
`TOPIC` value — a metric-labeling bug, not an engine fault.)

## Wave 6 — three dead-spending fixes (split-forced, 1 h)

result-content sharing + approval-time group de-dup + don't-offer-already-run.
2 deliberations, both split (6 + 5 tracks), 36 rounds, 0 errors.

| Metric | W5 (split, pre-fix) | **W6 (split + 3 fixes)** |
| --- | --- | --- |
| Output yield | 63% | **89%** |
| Capability failures | 2 | **0** |
| Escalations | 2 | **0** |
| In-group duplicate runs | 20% | 25% (one cross-cutting cap) |

**Two of three fixes fully landed (transcript-confirmed):**
- **Result-content sharing — WORKS.** Tracks now reference the parent's scan
  findings specifically and build on them ("0 Critical, 0 High … MED-1 auth guard
  confirmed not reverted by PR#85"). The Wave-5 *"the scan output wasn't surfaced
  in this thread"* complaint is **gone**.
- **Announce-loop — gone.** The unavailable-capability case is now stated once:
  *"Codebase connector is unavailable … a live uc_coverage_scan cannot execute —
  stating that gap once"* — then the persona pivots to an available capability.
- **Quality high** — Security Scan (v0.37.0, MED-1 fixed), ADR 0047 (two *new*
  perf findings the prior ADR missed: N+1 INSERT in `insertEvents`, missing
  `token_ledger` compound index), a Code Review that **REQUEST_CHANGES** on a real
  gap (savings-roi auth guard has no 401 test) while others said SHIP — genuine
  productive disagreement, concrete decisions.

**Remaining dead-spend — the concurrent-track race.** Architecture Review still
ran 2× (a cross-cutting capability two tracks both wanted at the same instant).
The approval-time guard catches *sequential* duplicates (Security Scan, Code
Review each ran ×1) but the check + spawn aren't atomic, so simultaneous approvals
across parallel tracks can both pass. **Last fix = an atomic capability claim**
(DB-unique on `group_root + use_case_id`, or serialized per-group approval). Also
a minor merge double-post observed once (harness re-merged a parent).

## Wave 7 — atomic capability claim (split-forced, 1 h) — FINAL

`deliberation_capability_claims` table, `PRIMARY KEY (group_root, use_case_id)`;
`approve_deliberation_action` does an atomic `INSERT OR IGNORE` claim *before*
spawn — first concurrent approval wins (`n==1`, runs), any simultaneous one gets
`n==0` and skips (builds on the result). Commit `0236fcfe9`, 36 tests pass,
migration live-confirmed (`errors: 0`). Grant Writing, Opus parent / Sonnet tracks.
3 deliberations resolved, 2 split (6 tracks each), 48 rounds.

| Metric | W6 (3 fixes) | **W7 (+ atomic claim)** |
| --- | --- | --- |
| In-group duplicate runs | 25% | **0%** ✅ |
| Capability failures | 0 | **0** |
| Escalations | 0 | **0** |
| Errors | 0 | **0** |
| Capability runs / groups | — | 6 runs / 3 groups, 0 dup |

**Duplicate-run race CLOSED.** Across 3 groups (12 tracks) every capability ran
exactly once — `On-Demand Security Scan`, `Code Review`, `Scheduled Architecture
Review`, `Idea Architecture Analysis` each ×1. The W6 "Architecture Review ×2"
cannot recur: the DB primary key arbitrates concurrent track approvals.

**Honest caveat — contended path not live-stressed.** In both split groups the
parallel tracks *naturally diversified* (each area-owner picked an area-appropriate
capability), so two tracks never raced for the *same* capability this wave. The 0%
is real (no dup occurred) but the claim's blocking branch wasn't independently
triggered live — it's proven by unit test (`claim_capability` returns true once,
false after) and correct by construction (PK constraint). Belt-and-suspenders only.

**Quality held (transcript-confirmed, P&S track).** Gated loop runs clean:
request (⏸) → run (▶) → result (🛠) → discuss-on-top → resolve. Result-content
sharing works *across tracks*: the architect references `ADR-0031` (the Idea
Architecture Analysis output) **and** the A11Y blocker from another track
("the block on ship is accessibility A11Y-ALERT1/2, not P&S") to make the right
call — defer P&S, propose "Implement per-request pagination per ADR-0031". No
empty rounds, no duplicate chat, grounded deliverables at parent (merge proposal)
and track (pagination task) level.

**Dead-spending pillar — closed.** Ladder across waves: yield 13% → 89%;
failures 29 → 0; escalations 22 → 0; in-group duplicate runs eliminated;
result-content sharing + announce-loop fixed. Autonomous-team reliability target
("works for days without dead spending") met on this engine.

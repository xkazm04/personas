# Deliberation Cooperation Cert (Design D, D7)

The deliberation engine's whole value rests on one risky claim: that giving
personas distinct, sometimes-conflicting cores makes them **cooperate
productively** — genuinely disagree, build on each other, and converge on
shippable work — rather than collapse to bland agreement (the classic
multi-agent failure mode). Unit tests can prove the *governance* (28 tests in
`engine::deliberation`) but not the *LLM behavior*. This cert grades that
behavior, end-to-end.

## What it is

`scripts/test/deliberation-certify.mjs` is a **live** cert (unlike the read-only
`loop-certify.mjs`): it runs a real deliberation through the actual prompts +
governance — mirrored verbatim from `src-tauri/src/engine/deliberation.rs`
(`build_moderator_prompt`, `build_turn_prompt`, `build_proposal_prompt`,
`plan_transition`, `resolve_speaker`) — over the real SDLC cores, with real
Claude calls (Haiku moderator, Sonnet persona turns + proposal), then grades the
cooperation evidence and emits a verdict.

```bash
node scripts/test/deliberation-certify.mjs            # run + grade + verdict
node scripts/test/deliberation-certify.mjs --json     # machine-readable report
node scripts/test/deliberation-certify.mjs --topic "…"  # custom decision topic
```

> Manual / local cert — it **spends tokens** (≈1 Haiku moderator + ≤3 Sonnet
> turns per round, + 1 Sonnet proposal + 1 Haiku judge). It is intentionally
> **not CI-wired**. Exit code: `0` for CERTIFIED/DEGRADED, `1` for FAILED.

## What it grades

Deterministic, from the run:
- **convergence** — did it reach a `resolved` outcome (vs escalated/aborted/stuck)?
- **proposal** — was a concrete `ProposalSpec` synthesized?
- **participation** — ≥3 distinct personas actually spoke (routing not collapsing)?
- **boundedness** — rounds within the bound; no runaway.

LLM-judged (a cheap Haiku judge over the transcript, 1–5 each):
- **divergence** — did members genuinely disagree from distinct viewpoints, or just agree?
- **building** — did they reference + build on each other, or talk past each other?
- **actionable** — did it land a concrete, executable outcome?

## Verdict

- **CERTIFIED** — converged + proposal + ≥3 speakers + divergence ≥3 + actionable ≥3 + bounded.
- **DEGRADED** — converged with a proposal and acceptable cooperation, but one
  non-critical shortfall (e.g. a low actionable score).
- **FAILED** — no convergence / no proposal / bland (divergence <3).

## Cost attribution (telemetry)

Deliberation spend is fully attributable in the live app:
- Every moderator / persona-turn / proposal call records a `companion_turn`
  ledger row stamped with `trigger_kind` ∈ {`deliberation_moderate`,
  `deliberation_turn`, `deliberation_proposal`} and the model used.
- Each call's `cost_usd` is rolled into the deliberation's
  `team_deliberations.cost_spent_usd` (the cost meter the UI shows and the hard
  cost floor reads).

So spend is queryable both per-deliberation (`cost_spent_usd`) and fleet-wide by
trigger kind (`SELECT SUM(cost_usd) FROM companion_turn WHERE trigger_kind LIKE
'deliberation_%'`). The cert script itself reports local call counts as a proxy
(its standalone Claude calls aren't ledgered the way the in-app engine's are).

## Relationship to the other certs

This sits alongside `loop-certify.mjs` (§9, the autonomous-loop liveness cert).
Where that observes continuous operation over a day-scale window from the live
DB, this proves the deliberation *mechanism* produces cooperation on demand. A
future extension can add a read-only mode that grades recorded deliberations
(`team_deliberations` + the `deliberation_id`-linked channel turns) once the
feature is run with `autonomous_deliberation` on.

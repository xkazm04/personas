# Empirical Model Tiering — large-scale Template → Persona → Execution → Lab quality harness

> Status: **Proposal / design hand-off** (2026-06-13). Authored from a cost-review
> session that wired per-capability model tiers into execution
> ([`project_cost_observability`], commits `4b2e04237`, `2ce332e13`) and ran a
> first 3-model Lab cross-test. Another session picks this up to design the
> autonomous large-scale version.

## 1. The problem — model tiers have no empirical backing

Every capability in the template/recipe bundle carries a `model_override`
tier (`haiku` / `sonnet` / `opus`, or `null` = sonnet default). As of
2026-06-13 the live distribution was **103 haiku / 26 opus / 170 sonnet**.
**None of those assignments was measured.** They were authored by judgment
when the bundle was baked (origin commit `413a3929a`), and until this session
they never even reached a spawned CLI (the wiring was broken three ways —
see `4b2e04237`).

Two things forced the issue:

1. **Cost.** Every team execution was silently riding the CLI *account
   default* (`claude-opus-4-8[1m]`), the single largest fleet cost driver.
2. **A first measurement.** A 3-model Lab arena cross-test (haiku / sonnet /
   opus, all at medium thinking, Immigration Dev Clone, 5 scenarios/cell)
   produced the first real numbers:

   | Capability | haiku | sonnet | opus |
   | --- | --- | --- | --- |
   | Triage Pipeline (output_quality) | 52 | 72 | 75 |
   | Implementation & PR (output_quality) | 71 | 79 | 59* |

   \* the opus deficit is a **judge artifact**, not real degradation (§2).

   That was enough to justify a fleet-wide **haiku → sonnet safety conversion**
   (`ff3f018df`, all 103 haiku tiers → sonnet) — but it is nowhere near enough
   to *set* tiers per capability with confidence. We need to measure every
   capability, not extrapolate from one persona and five scenarios.

This doc proposes the autonomous harness to do that — and first documents the
shortcomings of the comparative tooling that the cross-test exposed, because
those must be fixed before a large run is trustworthy.

## 2. Shortcomings of the Lab arena as a quality-measurement tool (observed)

The Lab arena (`lab_start_arena` → `test_runner::run_arena_test` →
`engine::eval`) is the right shape — generate scenarios, run N models, LLM-judge
each — but as used today it has measurement-validity gaps. Each was hit firsthand:

1. **Judge result-parsing was silently broken (FIXED, `1389256d4`).** The LLM
   judge emits per-metric rationale fields (`tool_accuracy_rationale`, …) and
   omits the combined top-level `rationale`/`suggestions` strings, which were
   `serde`-required. Deserialization failed → **every** arena/eval cell silently
   fell back to keyword-overlap heuristic scoring (`"17/40 expected keywords
   found"`), not LLM judgment. This had been degrading *all* Lab quality scores
   fleet-wide, not just this test. Fixed by making the fields `serde(default)`
   so `validate_llm_result` synthesizes the combined rationale as designed.
   *Lesson:* the harness needs a guardrail that **refuses to report a score
   whose `eval_method` is `heuristic_fallback`** (or at minimum flags the run
   degraded), so a broken judge can never masquerade as a quality verdict again.

2. **Mock-tool sandbox makes `tool_accuracy` meaningless and poisons the judge.**
   Arena scenarios mock tool responses, so models *narrate* tool calls instead
   of making them. Result: `tool_accuracy ≈ 0` for **all** models (not a model
   trait — a sandbox artifact), and the composite (which weights tool 0.3) is
   unreliable. Worse, the judge penalizes the "fabricated/narrated" output
   *inconsistently across models*: on an identical narration the judge scored
   opus q=30 against sonnet 82 / haiku 85 — purely judge variance, which
   inverted the apparent opus↔sonnet ordering on the execution-heavy capability.
   **This is the single biggest blocker** to trusting cross-model comparison on
   any capability whose value is real tool execution (implement / PR / release).

3. **Small N + high variance.** 5 scenarios/cell. Close models (sonnet vs opus,
   within ~3 pts on triage) cannot be separated; a single outlier scenario
   swings the aggregate. No confidence interval, no significance test.

4. **Judge is itself an unpinned confound.** `run_llm_eval` spawns
   `build_cli_args(None, None)` — the *account default* model (currently
   opus-4.8-1M), single judge, `--max-turns 1`, non-deterministic. The judge's
   own quality and run-to-run variance are uncontrolled.

5. **Scenario generation weakly honors `use_case_filter`.** The "Triage" arena
   generated implementation/PR-flavored scenarios; both arenas got near-identical
   scenario sets despite different focus instructions. Per-capability comparisons
   are contaminated by off-capability scenarios.

6. **Effort/thinking is a silent axis.** `TestModelConfig.effort` exists but the
   arena flow doesn't systematically sweep it; we pinned `medium` by hand. Model
   *and* effort jointly determine cost/quality — both belong in the matrix.

7. **No fleet-scale rollup.** The arena is per-persona, one capability, manual
   launch, manual result-reading. There is no Template→Persona→Execution→Lab
   sweep, no per-(capability, model, effort) results store, no dashboard, no
   recommended-tier output.

## 3. Proposed harness — autonomous large-scale capability quality testing

**Goal:** for every template capability, empirically determine the model (and
effort) that maximizes quality per dollar, and emit a recommended tier that
*replaces the unbacked bake*. The pipeline mirrors the product's own lifecycle:

```
Template ──adopt──▶ Persona ──per capability──▶ Execution ──▶ Lab arena (N models × efforts)
   │                                                                    │
   └────────────────────  recommended tier per capability  ◀───────────┘
                          (quality/cost matrix → decision)
```

### 3.1 Sweep structure
- **Input:** the template/recipe catalog (≈299 capabilities today).
- **For each capability:** adopt the owning template into an ephemeral persona
  (or reuse `EphemeralPersona` directly, as the arena already does), then run an
  arena over the model × effort grid — minimum `{haiku, sonnet, opus} × {medium}`,
  ideally `× {low, medium, high}` for the borderline ones.
- **Judge** each (capability, model, effort, scenario) cell → quality score.
- **Aggregate** into a `capability × model × effort` matrix with mean + spread +
  cost + latency, and a **recommended tier** (highest quality within a cost
  band, or cheapest model within ε of the best quality).
- **Emit** the recommendation as a candidate `model_override` per capability for
  review → feeds back into `_recipe_seeds.json` (the source the safety pass just
  edited) with an *empirical* rationale string.

### 3.2 Hard requirements (the §2 fixes are prerequisites)
- **Real-tool execution for execution-heavy capabilities.** The mock-tool
  narration artifact (§2.2) invalidates exactly the capabilities where model
  choice matters most. Either run those against a real sandboxed repo/connector
  (the seeded cert harness already does real GitHub work — reuse that substrate)
  or build a faithful tool simulator the judge can score on *correctness of the
  tool call*, not prose. Decide per-capability-class.
- **Robust judging.** Pin the judge model explicitly (don't inherit account
  default); use a **multi-judge panel or repeated judging** to cut the variance
  seen in §2.4; and never count `heuristic_fallback` cells (§2.1) toward a verdict.
- **Larger, capability-faithful N.** Enough scenarios per cell for a confidence
  interval, and scenario generation that actually constrains to the capability
  under test (§2.5).
- **Cost budget + checkpointing.** A full catalog sweep × 3 models × efforts ×
  scenarios is a large spend; it must be budgeted (`budget.total`-style), resumable,
  and prioritized (test the 26 opus + the highest-traffic capabilities first).
- **Results store + dashboard.** Persist the matrix (extend `lab_arena_results`
  or a new table); surface a per-capability quality/cost/recommended-tier view
  (the §11 cost block in `loop-certify` is the cost half; this is the quality half).

### 3.3 Autonomy
The sweep should be drivable unattended (it is itself a long autonomous process —
the thing this whole project certifies): a background op that walks the catalog,
respects the budget, checkpoints, and produces a review queue of tier-change
proposals the human accepts/rejects (same accept/adjust/reject loop as KPI
proposals). That closes the loop: the product tests its own model decisions the
way it tests everything else.

## 4. Open questions for the picking-up session
- **Mock vs real tools per capability class** — the central methodology call.
  Mocked is cheap and safe but invalid for execution-heavy work; real is faithful
  but needs the cert harness's repo substrate and is slower/riskier.
- **Judge design** — single pinned model vs panel; which model judges; how to
  detect/penalize the narration artifact fairly across models.
- **Decision rule** — "best quality" vs "cheapest within ε of best"; what ε; how
  much a quality point is worth in dollars (ties to the §11 cost framing).
- **Scope/cost** — full 299-capability sweep vs a stratified sample; cadence
  (one-off baseline vs re-run when models change).
- **Where the recommendation lands** — auto-PR to `_recipe_seeds.json`, or a
  review queue, or a dashboard-only advisory.

## 5. What already exists to build on
- `commands/execution/lab.rs::lab_start_arena` + `test_runner::run_arena_test` —
  the N-model arena (scenario gen → run → judge → persist).
- `engine/eval.rs` — the LLM judge (now parsing correctly, `1389256d4`).
- `lab_arena_runs` / `lab_arena_results` tables — per-(model, scenario) scores,
  cost, duration, rationale, `eval_method`.
- `EphemeralPersona::from_persisted` — run a persona's capability without
  persisting it (the adoption step can be ephemeral).
- The seeded cert harness (`scripts/test/`) — real-repo GitHub execution substrate
  for the real-tool path.
- `persona_executions.thinking_level` + `model_used` (`2ce332e13`) and
  `loop-certify` §11 — the live cost/power-mix observability the quality matrix
  pairs with.
- Tier resolution chain (`4b2e04237`): capability `model_override` → persona
  `model_profile` → `DEFAULT_CAPABILITY_MODEL` (sonnet) — the recommendation
  output plugs straight into `model_override`.

[`project_cost_observability`]: ../../  "session memory — cost review + tiering"

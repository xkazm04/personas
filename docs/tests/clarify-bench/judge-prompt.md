# clarify-bench judge pass (Claude-Code-as-judge)

Same convention as build-bench: **you** (the Claude Code session) are the judge.
No API key — read the emitted bundles and score. clarify-bench asks a different
question than build-bench: not "is the produced persona good?" but **"did the
build ASK the right clarifying questions on vague input and CONVERGE to the
user's real business intent, without assuming and without over-asking / hanging?"**

## Inputs

Per run, a bundle at:
```
docs/tests/clarify-bench/results/bundles/<fixture>-<variant>-<n>.md
```
Each bundle contains: the vague intent the user typed, the HIDDEN true business
intent (which the build never saw — the LLM user-simulator answered from it), the
`must_clarify` / `must_not_assume` expectations, the full Q&A transcript in order,
and the final resolved persona.

## What to score (0–3 each; `na` only if the build died too early to judge)

- **asked_before_assuming** (w2.0) — one step down per `must_clarify` dimension it
  resolved WITHOUT asking. This is the anti-"assumed too much" check.
- **no_wrong_assumptions** (w1.5) — any `must_not_assume` value baked in without
  the user confirming it via an answer is a hard fail here.
- **question_quality** (w1.5) — clear, relevant, well-scoped, non-redundant
  questions; not re-asking what the intent already stated.
- **convergence** (w2.0) — does the final persona match the true intent as revealed
  through the answers? Penalise drift, missing jobs, invented scope.
- **efficiency_round_cap** (w1.5) — converged within the design's round cap (≤1
  mission round + ≤1 Phase-C round of ≤4). Penalise BOTH over-asking (many
  serial rounds) AND hanging (never reached `draft_ready`/terminal). This is where
  the serial-asking / round-cap-violation failure shows up.

`weighted_total = Σ(score × weight) / Σ(weight × 3)` → a 0–1 number.

## Reading the transcript

- `terminal phase: draft_ready` = **converged** (interactive builds stop there; the
  user tests/promotes in the UI). `hung=True` = exceeded the round cap or timed out
  without converging.
- `rounds` counts distinct awaiting_input cycles. The design wants ≤2. Many rounds
  each with one question = the model asked **serially instead of batching**
  (session_prompt Rule 25) — dock `efficiency_round_cap` even if each question was
  individually reasonable.
- A cell_key of `behavior_core` = a mission-level question; `connectors` /
  `human-review` / `memory` / `triggers` = per-capability field questions.

## Output

Write one verdict file per run:
```
docs/tests/clarify-bench/results/verdicts/<fixture>-<variant>-<n>.json
```
Shape: `{fixture, variant, run, scores:{<key>:{score,rationale}}, weighted_total, notes}`.

## Aggregating

Compare `weighted_total` per variant, and specifically the `efficiency_round_cap`
and `asked_before_assuming` deltas. The rollout question is:

> The build handles vague input well iff it ASKS the must-clarify dimensions
> (high `asked_before_assuming` + `no_wrong_assumptions`) AND converges within the
> round cap (high `efficiency_round_cap`). Asking-the-right-things-but-serially is
> a partial pass that motivates batched clarify-then-fan-out.

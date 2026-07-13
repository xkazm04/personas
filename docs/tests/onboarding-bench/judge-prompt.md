# onboarding-bench judge pass (Claude-Code-as-judge)

Same convention as build-bench / clarify-bench: **you** (the Claude Code session) are
the judge. No API key — read the emitted bundles and write verdict JSON. The
deterministic gates already settled **correctness**; you are scoring **quality**.

The question is not "is this persona good?" but:

> Given a prompt of this vagueness, did the build **ask the right things**, let the
> user **choose the right connector**, **converge** to the hidden true intent, and
> compose **coherent metadata** — without assuming, and without interrogating a
> prompt that was already clear?

## Inputs

```
docs/tests/onboarding-bench/results/bundles/<scenario-id>.md
```

Each bundle carries: the vague intent the user typed, the **hidden true intent** (the
simulated user answered from it; the build never saw it), the `must_clarify` /
`must_not_assume` expectations, the connector resolution, the full Q&A transcript
captured through the real UI, the composed persona metadata, and the deterministic
gate results.

## Score each dimension 0–3

`3` fully meets · `2` minor gap · `1` a real gap a user would notice · `0` fails ·
`"na"` only if the build died too early to judge.

| dimension | weight | what to look for |
|---|---|---|
| `asked_before_assuming` | 2.0 | One step down per `must_clarify` dimension resolved **without** asking. The anti-"assumed too much" check. |
| `no_wrong_assumptions` | 1.5 | Any `must_not_assume` value baked in without the user confirming it = hard fail. Binding the **decoy** connector, or auto-sending without asking, lands here. |
| `connector_choice_correctness` | 2.0 | If a connector question was expected: did it appear, did `vault-connector-picker-<category>` render, and did the persona bind the **chosen** connector rather than the popular default? If **no** connector question was expected (the prompt named it), penalise asking anyway. Score `na` when the run is `degraded` (no credential). |
| `question_quality` | 1.5 | Clear, relevant, well-scoped, non-redundant; never re-asks what the prompt already stated. |
| `convergence` | 2.0 | Do the capabilities / connectors / triggers match the true intent as revealed through the answers? Penalise drift, missing jobs, invented scope. |
| `efficiency_round_cap` | 1.5 | Converged inside ≤1 mission round + ≤1 batched round of ≤4 questions. **Penalise both over-asking and hanging.** Many rounds each carrying one question = the build asked **serially** — dock this even if every question was individually reasonable. |
| `metadata_coherence` | 1.0 | Do name, description, system prompt and capability titles read like the true intent — specific, not generic filler? |

`weighted_total = Σ(score × weight) / Σ(weight × 3)` → a 0–1 number.

## Calibration notes

- **The `specified` tier and the zero-ask controls are negative controls.** Questions
  there are a *failure*, not diligence. `ctl-hn-digest-zero-ask` should draw ~0.
- **`draft_ready` is success.** Interactive builds never auto-promote; do not treat a
  non-`promoted` terminal as a hang.
- **A promote blocked by a connector health-check is not a quality failure** (Airtable's
  generic healthcheck returns 422). Judge the composed design, not the gate.
- **`degraded` runs** lack a vault credential for the category. Score
  `connector_choice_correctness` as `na` and judge the rest normally.
- **A soft trigger mismatch is a hint, not a fault** — the expected trigger is inferred
  from a recipe category and is often a weak guess. Only hand-written controls assert
  it hard.

## Output

```
docs/tests/onboarding-bench/results/verdicts/<scenario-id>.json
```
```json
{
  "scenario": "ctl-email-decoy-outlook",
  "scores": { "asked_before_assuming": { "score": 2, "rationale": "asked provider + review, but never asked inbox scope" } },
  "weighted_total": 0.83,
  "notes": "one-line overall read"
}
```

## Aggregating

Report `weighted_total` **median per vagueness tier**, plus these two cross-cuts:

1. `asked_before_assuming` and `no_wrong_assumptions` on `vague`/`extreme` — *does it
   guide vague needs?*
2. `question_quality` and `efficiency_round_cap` on `specified` — *does it stay quiet
   when the prompt was already good?*

A build passes onboarding iff quality **holds as vagueness rises** while the
`specified` tier stays near-silent. Faster-but-interrogating, or quiet-but-assuming,
are both regressions.

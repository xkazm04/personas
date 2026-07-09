# build-bench judge pass (Claude-Code-as-judge)

Same convention as the athena suite: **you** (the Claude Code session) are the
judge. No `ANTHROPIC_API_KEY`, no SDK — read the emitted bundles and write
verdict JSON. This scores **quality**; the harness already gated **correctness**
via hard assertions (they're echoed in each bundle for context).

## Inputs

Per run, a bundle at:
```
docs/tests/results/build-bench/bundles/<fixture>/<variant>-<n>.md
```
Each bundle contains: the user intent, the resolved capabilities (with tool_hints
+ triggers), the connectors + credential links, the hard-assertion outcomes, and
the rubric dimensions to score.

## What to do

For each bundle:

1. Read it. Judge the **produced persona design against the intent** — not the
   prose, the actual resolved structure.
2. Score each rubric dimension **0–3**:
   - **3** — fully meets the dimension, no caveats.
   - **2** — meets it with a minor gap.
   - **1** — partially; a real gap a user would notice.
   - **0** — fails the dimension.
   - Use **`"na"`** only if the build failed so early the dimension can't be judged.
3. Give a one-sentence rationale per dimension citing the concrete evidence
   (a capability id, a connector, a missing tool_hint).
4. Compute the weighted total = Σ(score × weight) / Σ(weight × 3), as a 0–1 number.

## Output

Write one file per run:
```
docs/tests/results/build-bench/verdicts/<fixture>/<variant>-<n>.json
```
Shape:
```json
{
  "fixture": "web-research-desk",
  "variant": "sequential",
  "run": 1,
  "scores": {
    "coverage": { "score": 3, "rationale": "all five jobs present as distinct caps" },
    "capability_distinctness": { "score": 2, "rationale": "sweep and deep-dive overlap on input" },
    "connector_binding_correctness": { "score": 3, "rationale": "airtable+notion bound with credentialLinks + tool_hints" },
    "trigger_sensibility": { "score": 2, "rationale": "scheduled scan correct; notion publish has no trigger" },
    "groundedness": { "score": 3, "rationale": "only native web tools + the two connectors, no hallucinated search" }
  },
  "weighted_total": 0.86,
  "notes": "one-line overall read"
}
```

## Aggregating across variants

After scoring every bundle, compare `weighted_total` medians per variant. Combined
with the harness's speed report, the decision rule for a rollout phase is:

> A variant is **FORWARD** iff its median build time is lower than `sequential`
> AND its median quality (`weighted_total`) is **not lower** than `sequential`
> (within noise). Faster-but-worse or slower-but-same is **not** progress.

Record the call in the phase's section of
[build-orchestration-plan.md](../../architecture/build-orchestration-plan.md).

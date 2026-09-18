# Typed decisions with a stated distribution - two paired runs (2026-09-18)

Question: does replacing a discrete closed-set answer with a probability per label, plus a
confidence computed from the distribution's shape and a code-owned threshold, improve a
decision seam in this harness? The idea comes from a "System One" decision model (typed
choice / ordered score / yes-probability, no prose); no key for that model was available, so
both runs emulate the request shape on the harness's own engine. Neither run changes product
code or any ladder arm.

Run either script from this directory:

    py typed_verdict_ab.py <memory-year dir> <out dir> 80  "claude:claude-haiku-4-5-20251001@low"
    py noul_grader_ab.py   <memory-year dir> <out dir> 120 "claude:claude-sonnet-5@low"

## 1. Admission verdict (the write-verdict gate's decision) - NOT BETTER

80 cases from `World(seed=7)`: first mention / restatement / replacement, true neighbour
withheld in 35%, same-key facts from other projects shown as distractors. Gold comes from the
generator (`supersedes`, restate, first sight), never from a model.

| | discrete (A) | distribution (B) |
| --- | --- | --- |
| exact label | 80/80 | 80/80 |
| wrong destructive verdicts | 0 | 0 |
| output tokens per case | 338 | 795 |
| latency per case | 6.9 s | 10.5 s |
| saturated confidence (>= 0.999) | n/a | 49/80 |
| format breaks | 0 | 1 sum error, 1 missing label |

The seam is at its ceiling on isolated single-message cases: there is nothing for a
confidence to rank, and the distribution costs 2.35x the output. The write-verdict arm's
real losses are therefore not in this decision taken alone; look at batching, neighbour
retrieval and extraction before the verdict. Return condition: a case class where the
discrete verdict's measured error exceeds 5%.

## 2. `applies:<fix>` model grader (`judge.py`, strict YES/NO) - BETTER

120 recorded (fix, reply) pairs this harness already graded with the strict model call.
Borderline label, derived without a model gold: the harness's own strict and lenient
rubric wordings disagree (7 of 120). Arm B is ONE call returning `p_yes` under the strict
wording.

- AUROC of `1 - |2p - 1|` against strict != lenient: **0.82**
- review band 0.2-0.8: flags 9 pairs (7.5%), holds 4 of the 7 disagreements
- review band 0.1-0.9: flags 27 pairs (22.5%), holds 6 of 7
- floor: `p >= 0.5` agrees with the strict YES/NO on **97.5%** (declared floor 95%)

Next change this suggests (not made here, because it moves the grading instrument every
published row was read through): have the model grader return `p_yes`, keep the verdict at
`p >= 0.5`, and write `borderline: true` on a row inside the band so between-arm diffs that
hinge on borderline rows can be read apart from mechanism.

## 3. What the second run found that it was not hunting

The identical strict prompt, on the identical 120 pairs, through the same judge spec
(`claude:claude-sonnet-5@low`), reproduced the RECORDED verdict on only **100 of 120**.
19 of the 20 flips run wrong -> correct, and the flipped pairs sit at `p_yes` 0.90-0.97,
outside any useful band. The rubric wording has not changed since 2026-09-03. One rerun
cannot separate sampling noise from the served model moving under a fixed identifier, but
one-directional flips point at the second. Consequence for the ladder: `adaptation`-class
rows graded on different dates are not comparable at the +-5-probe level FINDINGS.md
discusses, and the cache hides this because a cached verdict never re-asks. A stated
probability does not flag it; a dated re-grade of a fixed pair sample would.

# UAT rubric — the evaluation lens

The operational lens every Character applies, at both levels. Backbone: **Nielsen heuristic evaluation** + **cognitive walkthrough** + **jobs-to-be-done** acceptance.

## The 7 dimensions

| # | Dimension | The question | Notes |
|---|---|---|---|
| 1 | **completion** | Can the Character actually finish their job, end to end? | Journey-level, not step-level. Every step can pass and the job still fail. |
| 2 | **effort** | How much work/clicks/thinking does it cost vs. the value? | Friction, dead-ends, re-entry, mode confusion. |
| 3 | **clarity** | Does the Character always know where they are, what to do next, what just happened? | Cognitive-walkthrough core. |
| 4 | **trust** | Would the Character trust the output / the app with their data, accounts, money? | Credentials-stay-local is a real promise here; surface it. |
| 5 | **missing** | Is a piece the job needs simply absent? | The class traditional tests are blind to. |
| 6 | **time-saved** | Is it meaningfully faster than the Character's manual/current way? | Per-Character anchor. Slower-than-manual = a finding, not a pass. |
| 7 | **senior-quality** | Is the AI/automation output at least as good as a senior in the role would produce? | The reliability floor. Generic/shallow/wrong output fails even if it "worked". |

## Cognitive-walkthrough questions (asked at each step, in-character)

1. Will the Character try to achieve the right effect here? (Is this the obvious next move?)
2. Will they notice the correct affordance is available? (Is it visible / labeled / reachable?)
3. Will they connect the affordance to the effect they want? (Does the label/icon match their mental model?)
4. After acting, will they see progress toward their goal? (Feedback, state change, output.)
5. **(AI surfaces)** Is the output grounded in *their* real context, and is it senior-quality? Or generic machinery fed thin context?

## Severity

| Severity | Meaning |
|---|---|
| **blocker** | The Character cannot finish the job at all. |
| **major** | The job finishes but a senior wouldn't accept the result / the friction is adoption-killing. |
| **minor** | Real friction or quality gap, but the job completes acceptably. |
| **polish** | Cosmetic / nice-to-have. |

## Finding types

`missing-feature` · `quality-gap` · `broken-flow` · `confusion` · `trust`

A finding may also be a **strength** (positive) — record those too; they tell maintainers what NOT to touch and feed the synthesis.

## Verdict states

- **Per-journey (L1):** `L1-pass` (structurally sound) · `L1-conditional` (completes but has majors) · `L1-fail` (structural gap blocks the job).
- **Per-finding (L2 adversarial):** `confirmed` · `refuted` · `uncertain`. Only `confirmed` reaches the headline.
- **code_check:** `confirmed-absent` · `present-but-missed` · `present-broken` · `by-design` · `n-a`.
- **reachable (L1):** whether the surface is in this Character's reachable set (tier / dev-flag / fixture). A finding on an unreachable surface defers its job-impact verdict to L2.

## Scoring a journey for a Character

For each of the 7 dimensions, score `pass | partial | fail` with one line of evidence. The Character's **scored acceptance criteria** (in their file) are the binding checks — apply them identically every run. The dimensions are the shared frame; the scored criteria are the per-Character harness.

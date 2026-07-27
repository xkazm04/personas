# Choosing model and reasoning effort — what we measured

**Status: preliminary, and narrower than it started. ONE valid problem shape,
one sample per cell, 2026-07-24/25.**

> **P1 (invent + implement + verify) was run and is DESCOPED — do not cite it.**
> Its held-out corpus was synthesized numeric traces. When those traces were
> finally authored as real AnimSequences and opened in the editor, the skeleton
> was visibly mangled — no natural pose, motion that makes no sense. The fixtures
> were never anatomically valid, so every P1 measurement built on them (judged
> ranking, contested cross-check, `objective_core`) is void.
>
> Two lessons survive, and they are worth more than the arm that died:
> 1. **The brief was too weak to lead the models.** It asked for a framework over
>    recorded fixtures and never forced any variant to look at a rendered result.
>    None did. Every attempt verified itself with arithmetic over its own
>    synthetic data, and no amount of reasoning effort changed that — this was a
>    *specification* failure, not a capability one.
> 2. **The harness made the same mistake it was measuring.** Its verification pass
>    confirmed the numbers round-tripped into the asset and reported all six green.
>    It never asked whether the pose was meaningful. A gate that asserts data is
>    not a gate on behavior — which is the exact failure class P1 existed to
>    detect.
The harness, raw runs and full result live in
[`docs/tests/model-bench/`](../tests/model-bench/README.md). Everything below is
re-measurable: if you doubt a claim, re-run the shape rather than argue about it.

---

## The one-paragraph version

Eight runs — Opus and Fable at low/medium/high/xhigh — attacked one genuinely
unsolved design problem in isolated worktrees, one shot each, no ability to ask
anything, then were ranked blind. **On long-form design, more effort was worse
past medium.** The priciest run wrote 1,327 lines, lost track of its own
cross-references, and was the only run to violate its brief; Opus-medium ranked
first. Every cell landed within 5% of ceiling on the rubric, so the cheapest
(Fable-low, 3.7× fewer tokens) was very nearly as good. The **model** axis is
unresolved — judges favored their own family — so decide model on cost.

A second arm (build + implement + verify) was run and **descoped as invalid**;
see the banner above. Its lesson is about specification, not models.

---

## 1. What was actually measured

| | P3 — greenfield design (the one valid arm) |
|---|---|
| Repo | pumper |
| Task | design drift-detection/repair for extraction; **write no code** |
| Deliverable | one design document |
| Spend range | 17k–63k output tokens |
| Wall clock (8 concurrent) | 5–25 min |

**Same brief, byte-identical, per shape.** One git worktree per run. Headless
`claude -p`, so there was no question surface and no run could receive help.
One shot — no resume, no budget top-up.

## 2. The ranking

Ranked blind, identity and all cost figures stripped, labels shuffled.

| rank | variant | output tokens | weighted rubric |
|---|---|---|---|
| 1 | Opus-medium | 47,489 | 4.00 |
| 2 | Fable-xhigh | 57,375 | 4.00 |
| 3 | Opus-high | 51,260 | 4.00 |
| 4 | Opus-xhigh | 63,211 | 4.00 |
| 5 | Opus-low | 36,889 | 3.95 |
| 6 | Fable-medium | 27,161 | 3.95 |
| 7 | Fable-high | 38,291 | 3.86 |
| 8 | Fable-low | 17,376 | 3.82 |

### What this says

- **Opus inverts above medium** — medium ranked 1st, xhigh 4th at 33%
  more spend. The blind judge named the mechanism without knowing whose work it
  was: *"at 1,327 lines its internal cross-references drifted out of sync … exactly
  the failure mode of writing past the size you can keep consistent."* That run was
  also the only protocol violator in its wave.

**The model axis is unresolved — do not use this benchmark to pick a model.**
When a second judge was asked to re-rank a sample (on the arm since descoped), it
disagreed with the primary at Spearman ρ = **0.50**, below the 0.7 bar — and **each
judge ranked its own model family's run first**, agreeing only on the worst. One
small sample cannot establish self-family preference, but it is exactly the bias a
cross-check exists to detect, and it is reason enough to refuse any
model-vs-model conclusion here. Effort effects are within-model and unaffected.

**Cheap was nearly enough.** Every cell landed within 5% of ceiling on the rubric;
Fable-low produced a document scored 3.82/4 for **3.7× fewer tokens** than the
winner. Escalation bought defect-freedom — fewer mis-citations, tighter internal
consistency — not better ideas.

## 3. Effort could not be verified the way we wanted — read this before trusting the axis

The intended acceptance test was "thinking tokens differ ~10× between low and
xhigh." **It cannot be run.** Thinking blocks are emitted but redacted to empty
strings in both the stream-json output and the persisted transcript. There is no
way for this harness — or for a session inspecting itself — to measure how much
reasoning happened.

Substituted instrument: total output tokens with visible output held constant.
Opus low 586/624/581 vs xhigh 961/942/1065 across three repeats — non-overlapping,
deterministic in direction. On unbounded work: Opus 9.4k → 25.0k, Fable 4.6k → 13.2k.

**Negative control, and it matters:** on a prompt with a hard output cap (*"exactly
three bullets, max 15 words"*), Opus showed **no effort response at all** —
104 / 96 / 101 / 104 / 112 output tokens across low → max — while Fable still
responded (130 → 761). Tightly constraining output length can silently collapse
the effort axis. If you cap the output, you may be paying for effort you are not
getting.

## 4. Why you cannot rely on a model's self-assessment here

Two independent findings, both robust:

1. **No introspection is possible.** Thinking content is redacted everywhere (§3).
   A session cannot observe its own reasoning depth, so "this felt hard" is not
   evidence of anything.
2. **Judge models saturate.** Asked to score attempts 0–4 on a rubric, Fable-high
   put three of eight P3 attempts at a perfect 4-4-4-4-4-4-4 and six of eight on
   the second arm. Opus-high, cross-checking blind, scored **every** sampled
   attempt a straight 4 on every dimension. (These are observations about the
   *judges*, and hold regardless of the descoped arm's fixtures.) Spearman ρ was *undefined* — neither judge produced any
   variance to correlate.
   Worse, the same judge logged **3–5 unsubstantiated claims per attempt** in its
   claim audit while still awarding 4/4 on *evidence discipline*. It found the
   defects and did not price them.

Only **forced ranking** discriminated, and only when the judge was made to produce
a strict order with a concrete separator per adjacent pair. (The protocol's
original cross-check — have a second judge *re-score* a sample — is useless for
the same reason it saturates. Changing pass 3 to a forced ranking of the sample is
what made ρ computable at all, and it immediately returned 0.50.) **Absolute
self-assessment of quality — by a model, about a model — carried close to zero
signal in this benchmark.** That is the strongest reason to prefer objective gates
and human review over any model's confidence, including this one's.

## 5. The finding that outranks the matrix

On P3, **all eight attempts missed the same thing**. Every design treats repair as
selector-space search over the body the cheap fetch tier returned. None handles a
site going client-rendered — the HTML still arrives, every selector goes empty, and
the correct repair is fetch-tier escalation to the browser engine, one line of tier
policy, not a new selector. A grep across all eight documents finds no mention of
JS rendering, hydration or SPA shells.

No model at any effort caught it. **The binding constraint was problem framing, not
model selection.** Escalating the model or the effort would not have found it;
reframing the problem would have. Treat that as the default hypothesis when work
comes out disappointing.

## 6. Gates, and why you re-run them yourself

A methodology note that outlived its arm: all 8 runs passed typecheck and all 8
showed 3 failing test files — and so did a **baseline run at the pre-spawn
commit**, on the identical three files. No variant introduced a single new
failure. Without that baseline, eight runs would have been recorded as breaking
the suite.

The general rule the harness enforces, worth keeping: **every gate reported was
re-run by the orchestrator; none was taken from a run's own claim.** One run
independently reached the same conclusion by extracting a pristine `git archive` of
HEAD — the others asserted it from inspection.

## 7. What we do not know

- **Only one problem shape was validly measured.** Long-form design. The
  build-and-verify arm is void (banner above); the review-and-ship shape (P2) was
  never run. That is the shape closest to daily work in this repo, so any
  guidance about reviewing and shipping is extrapolation from nothing.
- **One sample per cell, nothing replicated.** Ranks 2–7 were separated by
  localized defects — a mis-cited line, a cross-reference drift — plausibly inside
  run-to-run noise. Rank 1 and rank 8 are the only positions worth defending.
- **The ranking comes from a single judging session.**
- **The effort axis was verified by proxy, not by the intended instrument** (§3).
- **The design winner is being implemented** in pumper (`impl-resilient-extraction`).
  Whether the top-ranked design survives contact with the code is the real test of
  whether the ranking meant anything, and it is not in yet.

## 8. Re-running this

```bash
# the runbook the orchestrator session follows
docs/tests/model-bench/ORCHESTRATOR.md
```

Model ids and effort behavior will drift. The value of this document is not its
table — it is that the table is **cheap to regenerate**. Re-measure before
believing a claim here that matters to a decision you are about to make.

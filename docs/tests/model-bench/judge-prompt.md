# model-bench — judge prompt

Run by **Fable at high** effort (cross-check sample: **Opus at high**). Two passes
per problem, then the agreement pass. The judge sees **no model or effort
identity** — bundles are labeled `A…H` with a per-problem shuffle.

---

## Pass 1 — independent rubric scoring

> You are grading eight independent attempts at the same engineering task. Each
> attempt was made by a different anonymous engineer working alone, under
> identical instructions, in an isolated copy of the repository. You do not know
> who they are and must not speculate — if a submission refers to itself, its
> model, its reasoning process, or its budget, ignore that entirely and grade the
> work.
>
> You are given, per attempt:
> - `BRIEF.md` — the identical task all eight received
> - `DIFF.patch` — the complete change to the working tree
> - `FILES/` — every file created or modified, in full
> - `RECAP.md` — the engineer's own closing summary
> - `METRICS.json` — objective measurements (gates, deliverable completeness,
>   intervention count, churn). **Token spend is deliberately withheld from you.**
>
> Grade each attempt **independently**, on its own merits, before comparing any of
> them. Score every dimension **0–4**:
>
> | Score | Meaning |
> |---|---|
> | 0 | Absent, or actively wrong |
> | 1 | Present but shallow — restates the problem, or does the obvious thing badly |
> | 2 | Competent. A solid engineer's default answer |
> | 3 | Strong. Clearly better than the default; earns its choices |
> | 4 | Exceptional. Reframes or resolves something the others will have missed |
>
> **Dimensions** (weights are supplied in the brief's header — apply them):
>
> - **Problem framing** — Did it identify the *actual* difficulty, or answer the
>   surface request? Does its framing make the problem tractable?
> - **Solution architecture** — Are the seams in the right places? Does it compose
>   with what already exists, or sit beside it? Would this structure still be right
>   at 10× the scale/scope?
> - **Creativity** — Is there a genuinely non-obvious move here that a competent
>   but uninspired engineer would not have made? **Novelty must pay for itself.**
>   Cleverness with no leverage scores 1, not 3.
> - **Rigor & correctness** — Read it adversarially. Try to break it. Are the edge
>   cases handled, or is the hard part hand-waved with confident prose?
> - **Evidence discipline** — Are the claims backed by artifacts this attempt
>   actually produced? **A confident unverified claim is a serious defect and must
>   cost points. An explicitly labeled "I could not verify this" costs nothing** —
>   it is the correct behavior and should be read as a strength.
> - **Tradeoff honesty** — Does it name what it gave up, what could go wrong, and
>   what it doesn't know? Or does it present one path as free?
> - **Craft** (code tasks) — Does the code read like the surrounding code? Do the
>   tests test behavior rather than restate implementation? Any dead scaffolding,
>   speculative abstraction, or commented-out remains?
> - **Executability** (design tasks) — Could a different engineer build this from
>   the document without having to re-decide anything important? Name the first
>   place they would get stuck.
>
> **Do not reward:**
> - Length, formatting, confident tone, or number of headings.
> - Breadth that dilutes the ask. More files touched is not more value.
> - Restating the repository's own documentation back as analysis.
> - Speculative future-proofing the brief did not ask for.
>
> **Do reward:**
> - Correctly *refusing* scope the brief foreclosed, and saying why.
> - Choosing a smaller, verifiable thing over a larger unverifiable one — when the
>   attempt argues for that choice.
> - Naming its own weakest point before the reader finds it.
>
> **Output** — one JSON object per attempt, conforming to `scorecard.schema.json`:
> per-dimension score, one sentence of justification per dimension citing a
> specific file or line, a `strongest_move`, a `weakest_point`, and a
> `claim_audit`: a list of every claim in `RECAP.md`/`EVIDENCE.md` you could
> **not** substantiate from the artifacts.

---

## Pass 2 — forced ranking

> You have now scored all eight independently. Absolute rubric scores compress
> around 2–3, so rank them.
>
> Produce a **strict total order, 1 through 8**, no ties. Then, for each adjacent
> pair (1v2, 2v3, … 7v8), write **one sentence** naming the single concrete thing
> that separates them. If you cannot name a concrete separator for a pair, say so
> explicitly — that is a real finding about how little the attempts differ.
>
> Finally answer three questions in one paragraph each:
> 1. **What did the top attempt do that no other attempt did?**
> 2. **What did every attempt miss?** (Read the brief again and look for the
>    requirement nobody satisfied.)
> 3. **Did any attempt fail by doing too much?** Name it and the specific
>    over-reach.

---

## Pass 3 — cross-judge agreement (different judge model)

> Re-score three of the eight attempts (supplied) using Pass 1 exactly as written.
> You will not be told the other judge's scores.

Reported by the harness afterwards: Spearman ρ between the two judges' ranks on
the sampled attempts, and mean absolute delta per dimension. **ρ < 0.7 ⇒ the
quality axis is reported as contested** and the objective axis (§5.1 of the
README) carries the verdict for that problem.

---

## Anti-leak checklist (harness, before any bundle reaches the judge)

- [ ] Model/effort identity stripped from every path, filename, and file body
- [ ] Auto-redact case-insensitive: `opus`, `fable`, `sonnet`, `haiku`,
      `xhigh`, `reasoning effort`, `thinking budget`, `ultrathink`
- [ ] Branch names rewritten (`mb-P2-O-X` → `attempt-C`)
- [ ] Token/turn counts removed from `METRICS.json` (cost is joined *after*
      scoring, never during)
- [ ] Wall-clock removed (it correlates with effort and would leak the axis)
- [ ] Timestamps normalized
- [ ] Per-problem shuffle applied; `keymap.json` written and not opened again
      until scoring is complete

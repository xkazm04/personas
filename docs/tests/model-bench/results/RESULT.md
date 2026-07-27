# model-bench — RESULT (P3 only; P1 descoped, P2 never run)

**Run id:** 2026-07-24/25 · **Ran:** wave 0 (pilot, discarded), wave 1 (P3 × 8),
wave 2 (P1 × 8 — **descoped as invalid**, §0).
**Never run:** P2 (waves 3a/3b), the review-and-ship shape.
**Therefore:** exactly one problem shape was validly measured. The cross-shape
decision table the README promises cannot be written, and is not attempted.

---

## 0. P1 — DESCOPED, invalid. Do not cite any P1 number.

Wave 2 ran to completion (8/8 delivered, zero protocol deviations, gates
re-run against a baseline, blind judging, a cross-check at ρ = 0.50, and a full
`objective_core` pass). **All of it is void**, by operator decision on 2026-07-25,
and the reason matters more than the numbers did.

The held-out corpus was six *synthesized* numeric traces. Late in the run they
were authored into real `AnimSequence` assets and opened in the editor: the
skeleton is mangled, there is no natural pose, and the motion makes no sense. The
fixtures never encoded anatomically valid animation, so every measurement built on
them — the ranking, the contested cross-check, `objective_core` — measured
agreement with a broken artifact.

**Two findings survive, and they are the useful part of the arm.**

1. **The brief was too weak to lead the models.** It asked for a framework over
   *recorded fixtures* and never required any variant to look at a rendered
   result. None did. Every attempt verified itself with arithmetic over its own
   synthetic data, at every model and every reasoning effort. No variant treated
   "is this actually a pose?" as a question worth asking. That is a specification
   failure, not a capability one — and no amount of effort would have fixed it.

2. **The harness committed the same error it was built to detect.** The authoring
   script's verification pass read every asset back, compared stored rotation
   ranges against the traces, matched all six exactly, and printed a green
   verification table. It confirmed that numbers round-tripped. It never asked
   whether the pose was meaningful. **A gate that asserts data is not a gate on
   behavior** — the precise failure class P1 existed to measure, reproduced by the
   instrument measuring it, and caught only when a human opened the asset.

Raw artifacts for the arm were removed in the 2026-07-25 cleanup. What remains
worth keeping is above.

---

## 1. The decision table — greenfield design (P3)

> **For greenfield design of a large subsystem, the model × effort matrix did not
> separate at the resolution of this rubric.** All eight attempts produced a
> complete, buildable design document; two independent judges (Fable-high and
> Opus-high) both scored at or within one point of ceiling on every dimension.
> The cheapest variant reaching ≥90% of the best variant's quality is
> **Fable-low, at 17,376 output tokens — 3.7× cheaper than the top-ranked
> variant** and 27% of the most expensive.

| | rank | weighted rubric (0–4) | output tokens | value density (rubric/100k tok) | wall (min, c=8) |
|---|---|---|---|---|---|
| **Opus-medium** | **1** | 4.00 | 47,489 | 8.4 | 12.8 |
| Fable-xhigh | 2 | 4.00 | 57,375 | 7.0 | 24.8 |
| Opus-high | 3 | 4.00 | 51,260 | 7.8 | 14.2 |
| Opus-xhigh | 4 | 4.00 | 63,211 | 6.3 | 16.7 |
| Opus-low | 5 | 3.95 | 36,889 | 10.7 | 10.5 |
| Fable-medium | 6 | 3.95 | 27,161 | 14.6 | 7.4 |
| Fable-high | 7 | 3.86 | 38,291 | 10.1 | 16.2 |
| **Fable-low** | 8 | 3.82 | 17,376 | **22.0** | 5.1 |

**The operating recommendation for this shape:** use the cheap corner. Escalation
buys *defect-freedom* (fewer mis-citations, tighter internal consistency), not
better ideas. If the design document will be handed to an implementer who cannot
ask questions, the marginal spend is worth it; if it will be reviewed by its
author, it is not.

**Honest caveat on the ranking, stated before the analysis that uses it:** the
rank column comes from a *single* forced-ranking session. Ranks 2–7 were
separated by localized defects (a mis-cited line number, a cross-reference drift,
one under-specified API field), not by capability differences. Those separators
are plausibly within run-to-run noise, and the ranking was not replicated. Rank 1
and rank 8 are the only positions I would defend, and even those on one sample.

---

## 2. Effort elasticity — and a real inversion

**Opus inverted above medium.** medium (1) → high (3) → xhigh (4), with low at 5.
Spend rose monotonically (36.9k → 47.5k → 51.3k → 63.2k) while rank fell after
medium. The judge, blind to identity, named the mechanism on the attempt that
turned out to be **Opus-xhigh**:

> "at 1,327 lines its internal cross-references drifted out of sync (§8.x for a
> section numbered 10; five SQL sketches in non-compiling shorthand), which is
> exactly the failure mode of writing past the size you can keep consistent."

Opus-xhigh was also the **only protocol violator** in the wave — it edited
`docs/features/README.md` to add an index entry, against the brief's "the only
file you create is the design document." Both failures are over-reach, and both
appeared only at the top of the effort axis. This is the over-thinking failure
mode README §5.3 hypothesized, observed directly.

**Fable did not invert cleanly but was noisy:** xhigh (2) → medium (6) → high (7)
→ low (8). Effort bought Fable its one top-3 finish, but high scoring below
medium at 1.4× the tokens is not a curve — it is noise, and it should be read as
"Fable's effort response on this task is not reliably ordered below xhigh."

---

## 3. Model comparison at matched effort

| effort | Opus rank | Fable rank | Opus tokens | Fable tokens | ratio |
|---|---|---|---|---|---|
| low | 5 | 8 | 36,889 | 17,376 | 2.12× |
| medium | **1** | 6 | 47,489 | 27,161 | 1.75× |
| high | 3 | 7 | 51,260 | 38,291 | 1.34× |
| xhigh | 4 | **2** | 63,211 | 57,375 | 1.10× |

Opus beat Fable at every matched effort except xhigh, where Fable's best run
(rank 2) beat three Opus runs. **Opus costs 1.1–2.1× more tokens at matched
effort**, and the multiplier shrinks as effort rises — the two models converge on
spend at the top of the axis, where they also converge on quality.

---

## 4. Judge agreement — the quality axis is unresolved, not contested

Spearman ρ **could not be computed.** Both judges saturated: the Opus-high
cross-check scored all three sampled attempts (ranks 1, 4, 8) at a straight 4 on
every dimension; the Fable-high primary scored two of the three identically and
the third at 3.82. Mean absolute per-dimension delta was 0.00 / 0.00 / 0.14. With
no variance in either judge's scores on the sample, rank correlation is undefined.

This is **not** the "contested" case README §1 anticipated (judges disagreeing).
It is a different failure: **the rubric has insufficient resolution for this
problem.** Two independent judges of different model families agree that all
eight submissions are excellent, which is itself a finding — but it means the
judged axis contributes almost nothing to the verdict for P3, and the objective
axis plus the pass-2 qualitative ranking carry it.

The cross-check as designed cannot validate a ranking, because it asks only for
absolute scores. If P1/P2 run, **pass 3 should be changed to a forced ranking of
the sampled subset**, not a re-score.

---

## 5. What every attempt missed

Independently of the matrix, the strongest single output of this run is a defect
common to all eight designs, surfaced by the pass-2 judge:

> Every attempt treats repair as **selector-space search over the body the cheap
> fetch tier returned**. None handles a site going client-rendered: the HTML still
> arrives, the fetch-admissibility gate passes, every selector goes empty, and the
> correct repair is *fetch-tier escalation to the `browser` engine* — one line of
> tier policy — not a new selector. A grep across all eight documents finds no
> mention of JS rendering, hydration, or SPA shells. As designed, every one of
> these systems would ask an LLM to find selectors in a document where the data is
> not present, burn the repair budget, and quarantine a source whose fix was a
> config change.

Neither model at any effort caught this. That is a stronger signal about the
frontier of this work than any cell in the matrix: **the binding constraint was
problem framing, not model selection** — the null-result outcome README §6
explicitly names as real and useful.

---

## 6. Failure signatures

- **Opus-low / Fable-low** — under-scope by *compression*, not omission. Fable-low's
  32.8k-char document (vs 77.8k for Opus-xhigh) covers the required ground but
  leaves the promotion path — the subsystem's whole point — for the implementer to
  invent.
- **Opus-medium** — the cleanest point observed: every spot-checked repo citation
  verified exactly, and the only attempt to route self-inflicted breakage to
  rollback-never-repair.
- **Opus-xhigh** — over-builds and loses internal consistency; the only protocol
  violation.
- **Fable-high** — the noisiest cell: ranked below Fable-medium at 1.4× the spend,
  and the only run whose two token instruments disagreed (§7).

---

## 7. Threats to validity that actually bit

1. **The effort-verification instrument does not exist.** README §4.5's acceptance
   test (thinking tokens differing ~10×) is unrunnable: thinking blocks are emitted
   but redacted to empty strings in both the stream-json stdout and the persisted
   transcript. Substituted instrument (operator-approved): total output tokens with
   visible output held constant — Opus low 586/624/581 vs xhigh 961/942/1065 across
   3 repeats, non-overlapping. The axis is pinned; it was never verified at the
   magnitude the protocol asked for.
2. **Effort is suppressible.** Negative control: on a prompt with a hard output cap,
   Opus showed *no* effort response at all (104/96/101/104/112 output tokens across
   low→max) while Fable did (130→761). The briefs are unbounded so this should not
   have bitten here, but any future brief that constrains output length may silently
   collapse the axis.
3. **Judge saturation** (§4) — the primary measurement instrument for the quality
   axis returned almost no signal.
4. **Pass-1 independence was broken on the first attempt.** Batching all 8 into one
   judge session produced cross-referencing justifications ("a cost consequence no
   other attempt names"). Re-run as 8 isolated sessions; the batched scores are
   retained at `judging/P3-pass1-batched/` and were **not** used. Note the batched
   pass gave a *wider* spread (3.00–4.00) than the independent pass (3.82–4.00).
5. **One judge saw the worktree names.** The independent judge for label C globbed
   `README.md` across the pumper checkout and its results listed
   `.claude/worktrees/mb-P3-{O,F}-{L,M,H,X}/README.md`. It never opened a worktree,
   so no label→variant mapping was available to it, but it could infer the run was a
   model benchmark. Its attempt scored lowest, so no inflation is evident.
   **Structural fix for any future wave: name the worktrees neutrally** (`mb-P3-a1…a8`)
   so identity is not on the filesystem at all.
6. **Token instrument disagreement on one run.** Fable-high: 38,291 (stream `result`)
   vs 43,429 (transcript rollup), a 13% gap. The other seven agree to the token.
   Cause unidentified; the stream figure is used in this report and the disagreement
   is not smoothed away.
7. **Collector bugs found by the pilot, both fixed before wave 1 was scored.** The
   transcript emits one row per content block with message-level usage repeated
   (inflated Opus-low from 35,167 to 101,466 until deduped by `message.id`); the
   stream repeats `tool_use` blocks across deltas (Fable-high showed 151 tool calls
   vs 17 real) and `result.num_turns` is unreliable (reported 2 for a 13-message run).
8. **Single sample per cell.** No cell was replicated. With eight cells, one problem,
   and rank separations driven by localized defects, most of the ordering in §1
   should be treated as unreplicated.
9. **Wall-clock is not comparable across waves** and is reported only with its
   concurrency (all wave-1 runs at c=8).

## 8. Protocol compliance

- Briefs byte-identical: all 8 spawned from one file, md5 `96e7d0519e53a8e99e848ca840fdeb50`.
- Gates re-run by the harness, not taken from any run's claim: `crates/` unchanged in
  all 8 (P3's design-only gate) — **pass ×8**. Deliverable present and non-stub ×8.
- Commits: none. Pushes: none. `git stash`: never used, by any run or the orchestrator.
- Interventions: **0** — headless, no question surface existed.
- Ceilings: none hit (max 63,211 of 400,000 output tokens; max 24.8 of 180 min).
- Project memory directory: untouched.
- Protocol deviations: **1** — Opus-xhigh edited a second file (§2).

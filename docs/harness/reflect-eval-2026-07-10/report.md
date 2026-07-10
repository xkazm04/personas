# Reflect evaluation — live-data quality audit (2026-07-10)

First quality gate for the Memory Engine v2 **reflection** pass, run against the real
database (4,509 memories) via the test-automation server. Goal: verify proposals are
high-quality and harmless to original content BEFORE any is applied.

Harness: `scripts/memory/reflect-eval.mjs` (proposal-mode only — asserts zero live
mutation; never applies). Raw bundles (before-snapshot / proposal / checks / review.md
per persona) were produced in a session scratchpad; the judgment below is the durable
output.

## Runs

| Persona | Memories (non-archived) | Outcome | Insights | Archives | Integrity checks |
|---|---|---|---|---|---|
| T: Dev Clone | 61 | proposal `memprop_98cf29d1…` | 10 (consuming 56 sources) | 0 | ALL PASSED |
| T: QA Guardian | 60 | proposal `memprop_56af47cd…` | 10 | 1 | ALL PASSED |
| T: Dev Clone (2nd) | 61 | **timed out** at the 4-min CLI cap | — | — | — |

Integrity checks (deterministic, per proposal): every synthesize entry has ≥2 existing
non-core sources, non-empty insight, importance 1..5; archive targets exist, non-core,
not double-actioned; **zero live-row mutation** (before/after snapshots byte-identical).

## Fidelity judgment (adversarial, per insight, sources side-by-side)

**Dev Clone — judged directly: APPLY.**
- No fabrications found across all 10 insights; PR numbers, SHAs, file paths and causal
  claims all trace to sources.
- Contradiction handling is genuinely good: the `#65-vs-#63` PR-attribution conflict was
  resolved toward the heavily-confirmed side (access counts 71–92) **and the conflict is
  noted inside the insight** rather than silently dropped; the stale
  "tsc/eslint inoperable" claims lose to the explicit CORRECTION memories.
- Cross-insight preservation works: the junction-deletion hazard living inside a merged
  source was carried into the environment insight rather than lost.
- Note: aggressive compression — 56 of 61 memories consumed; active pool would go 61 → 15
  much denser rows (~55% char compression). Content quality justifies it here.

**QA Guardian — judged by an independent agent with the same rubric: APPLY.**
- No fabrications; every SHA/error-string/file:line traced. Contradictions (merged-fix vs
  earlier-proposed-fix; branch-protection reversal) picked the newer/confirmed side and
  annotated it.
- Minor recoverable losses flagged (none blocking): an open MEDIUM aria-label finding,
  an "ADR-0006 3/4" progress pointer, PR #16's unresolved final status. Two cosmetic
  soft spots (an inferred date; an unflagged 4/6-vs-3/6 source disagreement).
- The single standalone archive (a resolved bug filing) is justified; its dedupe
  signature survives in a separate closure memory.

## Verdict

**The reflection engine is safe and produces high-quality consolidations on real data.**
Both proposals recommended for APPLY (from Overview → Memories proposal flow). Apply is
itself reversible: sources archive (never delete), insights carry `derived_from`.

## Tuning follow-ups

1. **Timeout**: 61-memory reflections sometimes exceed the 4-min CLI cap (1 of 3 runs).
   Raise `memory_reflection.rs` timeout to ~8 min or trim the prompt (drop `created_at`
   / `access_count` fields, cap content length per memory).
2. **Compression aggressiveness**: consuming 56/61 memories in one pass is at the upper
   bound of comfortable. Consider a per-pass consumption cap (e.g. ≤60% of pool) so
   reflection stays incremental and each apply is easier to judge.
3. **Insight length**: several insights are 150–250 words (mega-memories). Fine for
   recall value-density, but a max-content-length hint in the prompt would keep the
   budget packer's granularity useful.
4. Losses the judge flagged (aria-label finding, ADR-0006 3/4 pointer) suggest a prompt
   nudge: "carry forward any OPEN/unresolved item verbatim — open threads never count
   as redundant."

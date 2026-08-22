---
layer: application
subject: agent-memory
technique: recall-injection
stack: rust
---

# Recall injection in the companion brain and persona engine (Rust)

Two recall systems realize the technique at different scales: the companion's
per-turn bundle (`src-tauri/src/companion/brain/retrieval.rs`) and the persona
engine's decay-scored packer (`src-tauri/db/src/memory_recall.rs`).

## The tiers, literally

`retrieval.rs` builds each turn's `Recall` from exactly the standard's three
tiers (`:1-24`):

- **Relevance** — a keyword (BM25) lane that runs in every build plus an
  ml-gated vector lane. The header records why the keyword lane exists: before
  it, the shipping build "returned the same N most-recent episodes and the
  same top-N facts on every single turn" — recall that did not depend on the
  question at all.
- **Always-include** — top facts, procedurals, active goals, open backlog by
  importance, "query-independent by design" (`:11-13`), each with its own
  small cap (`ALWAYS_INCLUDE_TOP_FACTS = 6` … `:77-89`) — the
  jealously-guarded constitutional tier.
- **Recency** — a tail with a floor: `RECENCY_FLOOR = 6` (`:70`), because
  "losing the immediately-preceding turn to a well-matched older one would be
  a worse failure than a slightly oversized window."

The budget discipline is the doc's own headline (`:15-24`): the episode window
is "a budget, not a per-lane quota" — all lanes converge on
`RECALL_EPISODE_TARGET = 20`, with the recency tail sized from what the other
lanes actually returned. The old hard-coded split delivered *fewer* memories
in the richer build when the vector lane came up empty — per-tier arithmetic
drifting from the total is exactly what a single declared budget prevents.

## Labeled, not smuggled

`format_facts` (`src-tauri/src/companion/prompt/:376-413`) renders each
recalled fact as `**key** (importance N, conf NN%) — value [from sources]`
under a header that names the epistemic status: "facts you've distilled —
every entry is cited". Procedurals carry the same annotation
(`prompt.rs:1366-1370`). The consumer sees grade and grounds, not bare
world-state. (Age/last-confirmed is not rendered — the one element of the
standard's label the surface omits.)

## Value-ranked packing under a character budget

`memory_recall.rs` is the packer half: `decay_score`
(`:144-167`) computes `importance × 0.5^(age/half_life(category)) ×
access_boost × dispute_penalty`, and `pack_by_budget` (`:187-200`)
greedy-packs whole entries by that score into a character budget — replacing
a blind "importance DESC then truncate" that could drop a fresh
high-importance memory "because an old, often-accessed one padded the budget
first" (`:7-12`). Task-relevant recall blends the same value score with
semantic similarity (`:283-299`), with SQL scoping still deciding
*eligibility* — relevance re-ranks, it never widens the candidate set
(`:345`).

## The loop back into retention

Recall feeds decay from both directions, as the standard's closing loop
requires: `access_boost` in `decay_score` makes used memories decay slower,
and the companion's lifecycle sweep is *triggered from the recall path* —
`maybe_run_lifecycle_sweep`
(`src-tauri/src/companion/brain/consolidation.rs:596-621`), throttled to 6h,
best-effort, hooked there precisely because it is "the path that actually
runs". Forgetting on the persona side archives rather than deletes
(`run_decay_forgetting`, `memory_recall.rs:430-458`) — reversible demotion,
with vector cleanup trailing as incremental GC.

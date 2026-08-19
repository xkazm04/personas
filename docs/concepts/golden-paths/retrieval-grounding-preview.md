# Retrieval grounding preview

> Situation node: `ai-and-agents/prompt-and-output/retrieval-grounding-preview` ·
> [situation spine](../situation-spine.json) · `sides: "client"` (**contradicted
> — §12.1**) · `twoSided: true` · recurrence 4 · risk low ·
> `convergence: "converged"` (**contradicted — §12.2**) · dimensions: ui ·
> function.
> Spine `why`: *"Showing which memories or documents the answer actually used."*
>
> **Short form** (Mode 2 batched tail): spine header, §0 headline, §2 the one
> way, §7 deviations, §9 rule-or-decline, §12 corrections. Every count carries
> two independent implementations.
>
> Composed 2026-08-17 against `master @ 2a874e692`. Sweep: the companion recall
> path (`src-tauri/src/companion/prompt.rs`, `session.rs`,
> `src/features/plugins/companion/RecallStrip.tsx`), the persona-memory recall
> path (`src-tauri/db/src/memory_recall.rs`, `repos/core/memories.rs`,
> `src/engine/runner/mod.rs`), the vector-KB search path
> (`src/commands/credentials/vector_kb.rs`,
> `src/features/vault/shared/vector/`), the shared retrieval lane
> (`src-tauri/core/src/retrieval/mod.rs`), and read-only copies of the
> **2026-08-17 purge backup** plus **the live databases**.

---

## 0. Headline

**`summarize_recall` is the answer to this leaf and it is already written.**
`src-tauri/src/companion/prompt.rs:102` takes the exact `Recall` value the prompt
builder consumed and projects it into the preview — *"Cheap: zero DB, just
borrows the fields we already have in memory."* The preview **cannot** disagree
with the prompt, because it is not a query; it is a projection of the value.
The defect this leaf is about — a preview computed by a second, similar-but-different
retrieval — is unrepresentable on this path. `RecallStrip.tsx` renders it, and
its docstring names the source precisely: *"the backend's
`companion://recall-preview` Tauri event, emitted once per turn right after the
prompt builder runs."* **Personas is ahead of the fleet here** (§12.2), and this
is the file to copy.

**Three findings follow, and only one of them is about the preview being wrong.**

**(1) The preview is live-only, and its persistence stopped six days before this
was written.** The backend emits an event; the *frontend* is what writes it back
(`src/features/plugins/companion/useTurnSidecars.ts:44`,
`void companionSaveTurnSidecar(payload).catch(silentCatch(...))` — fire-and-forget
with a silent catch). Measured against the date-aligned denominator, not the
lifetime one: in the window the sidecar existed (2026-08-05 17:22 → 2026-08-09
22:54) there were **129 companion turns and 83 sidecar rows, 80 carrying a
`recall_json`** — 62.0%. **After that window: 12 more turns, 0 sidecars, across
six days.** Reopen a conversation and the answer is there without its grounding.

**(2) The persona-run path has no preview at all, and no place to put one.**
`persona_executions` has 38 columns and not one records what grounded the run
(zero columns match `%mem%`, `%ground%` or `%recall%`).
The only artifact is a line in a log file —
`[MEMORY] Injected N memories (C core, A active packed by value, O omitted)`
(`src/engine/runner/mod.rs:938-944`) — which is **four counts and zero
identities**. Across the backup: **2,188 executions, 6,535 memories, 0 rows
anywhere recording which memory reached which prompt.**

**(3) The dangling-vector case is live, is 100%, and is inert by design — the
defect it exposes is in the observability, not the retrieval.** Measured on the
live files right now, not the backup: `personas_data.db` holds **5,158 rows in
`persona_memory_embedding_rowids` and 5,158 in `persona_memory_embedding_meta`**,
while `personas.db` holds **0 rows in `persona_memories`**. Every vector in the
store is an orphan. It cannot inject anything, and the code says why in advance —
`memory_recall.rs:341-345`: *"The KNN result is intersected with `candidates`
implicitly (hit ids not in the candidate set have no row to lift), so **orphaned
or foreign-persona embeddings can't inject anything** — SQL scoping still decides
WHAT is eligible; relevance only decides WHICH eligible entries win the budget."*
That is the correct architecture and it held under a stress test nobody designed.

What did not hold is the instrumentation. Every recall now runs a KNN of
`k = max(candidates × 4, 128)` over 5,158 dead vectors and logs
`hits=…, kept=…, dropped_far=…` (`memory_recall.rs:374-379`) — **three counters,
none of which is "hits that had no row to lift."** The diagnostic reports what the
index returned, not what the prompt received, and on this install those two
numbers are now maximally different.

---

## 2. The one way

**The preview is a projection of the retrieval value the assembler already
holds — never a second query — and it discloses everything that was withheld
between the index and the prompt.** Concretely:

**(a) Project, don't re-query.** The function that assembles the prompt returns
(or hands to an emitter) the same value it consumed; a pure `summarize(&Recall)`
turns it into the UI shape. A preview built from its own retrieval call is wrong
the moment the two queries differ by a filter, a cap, a clock or a tokenizer —
and it will differ, silently, because nothing compares them. `summarize_recall`
(`prompt.rs:102`) is the shape: zero DB, borrows in-memory fields, bounded by the
same caps the builder used.

**(b) Membership is decided by the authoritative store; the vector index only
orders.** Take the KNN hits as a *relevance map* keyed by id and intersect it
with a set the scoped SQL already produced. Then an orphan vector, a
foreign-tenant vector, or a vector written under a retired embedding model
cannot inject anything — it simply has no row to lift. This is what makes 5,158
dangling vectors a performance note instead of an incident, and it is the single
most load-bearing sentence in this document.

**(c) Count every attrition stage, and disclose the total.** Between "the index
returned N" and "the prompt contains M" sit a relevance floor, a model-compatibility
guard, a hydration join, a per-kind lane cap, a `min_score`, a source filter, a
`top_k` cut and a character budget. Each one that silently `continue`s is a
number the user needed. Return them as fields — `floorFiltered` on
`KbSearchResponse` is exactly right — and render the total, because *"showing 5 of
23"* is the difference between "nothing matched" and "your filter is too tight".

**(d) A dropped hit whose row is missing is a different event from a dropped hit
that scored badly.** The first means your index and your store disagree; the
second is retrieval working. Count them separately or you cannot tell a broken
join from a quiet corpus.

**(e) Show the score in the unit the reader thinks in, and keep the raw one
beside it.** A cosine distance is meaningless to a user and a percentage is
meaningless to whoever is debugging the embedder. Render the normalized value as
the primary badge and the raw distance in the metadata line.
`SearchResultCard.tsx:54,81` does both — `Math.round(result.score * 100)` as a
`%` badge, `distance` at 4 decimal places underneath. State the transform in the
type's doc comment (`score = 1.0 / (1.0 + distance)`, `vector_kb.rs:1175`) so
nobody reads the badge as a probability.

**(f) Persist the preview on the same write that persists the answer.** A
grounding record that exists only in an event stream is gone at the next reload,
and its write must not be a fire-and-forget call from the renderer — the process
that has the value and the durability guarantee is the backend.

**(g) Make every previewed item addressable.** Carry the `id`, not just the
title, so the chip can open the thing it names.
`RecallPreviewEntry { id, title }` (`prompt.rs:44-49`) does this, and
`RecallStrip`'s `onOpenInBrain` consumes it.

**Reach for:** `summarize_recall` + `RecallPreview` (`src/companion/prompt.rs:44-137`),
`RecallStrip` (`src/features/plugins/companion/RecallStrip.tsx`),
`personas_core::retrieval::{filter_by_distance_floor, filter_by_model, rank_into_lanes}`
(`src-tauri/core/src/retrieval/mod.rs`), and `KbSearchResponse.floorFiltered`.
**The one site to copy is `src/companion/prompt.rs:102-137` together with
`RecallStrip.tsx`** — a pure projection on the server and a collapsed strip above
the bubble on the client.

---

## 7. Deviations

**D1 — the preview is written back by the renderer, and the write has stopped.**
`useTurnSidecars.ts:44` fires `companionSaveTurnSidecar` and swallows failures via
`silentCatch`. Date-aligned counts (backup and live agree exactly: 1,779 turns,
83 sidecars in both files): **129 turns / 83 sidecars / 80 with `recall_json`**
inside the sidecar's own date window; **12 turns / 0 sidecars** after it, spanning
2026-08-10 → 2026-08-15. The lifetime ratio (83 of 1,779, 4.7%) is *not* the
honest number and is stated here only to be dismissed — the feature did not exist
for most of that history.

**D2 — `persona_executions` cannot record grounding.** 38 columns; none for
injected memories. The `[MEMORY] Injected …` line (`runner/mod.rs:938`) goes to
the execution log file, which means the grounding for a run is (a) prose, (b)
counts only, and (c) subject to `log_truncated`.

**D3 — the runner already computes the identities and throws them away.**
`runner/mod.rs:946-951` builds `all_ids: Vec<String>` — core plus packed-selected —
for the sole purpose of `increment_access_batch`. **That vector is exactly the
preview**, three lines from where it would be persisted, and it is dropped at the
end of the block. This is the cheapest deviation in the document to close.

**D4 — `select_search_results` has four silent attrition arms and discloses
one.** `vector_kb.rs:1158-1210`: `results.len() >= top_k` (break),
`hydrated.remove(chunk_id)` returning `None` (**the orphan arm**),
`score < min_score`, and `filter_source` mismatch. None increments a counter.
`floor_filtered` — computed 165 lines earlier at `:993` and correctly documented
as being applied *"BEFORE truncation so the caller learns how much noise was
cut"* — is the only number that reaches `KbSearchResponse`. So a search that
found 40 candidates, floored 5, failed to hydrate 20 and capped at 10 reports
`floorFiltered: 5`, and the 20 that vanished because index and store disagree are
invisible.

**D5 — the orphan arm is currently the whole story and reports nothing.**
`kb_chunks` = **0 rows** and `kb_documents` = **0 rows** in `personas_data.db`,
while `knowledge_bases` = 0 — the KB path is unpopulated on this install, so any
hit would fall through `hydrated.remove` → `continue`. And on the
persona-memory path the same shape is live at scale: **5,158 vectors, 0 owning
rows.** In both cases the correct behaviour (drop it) and the missing behaviour
(say so) are one `else` branch apart.

**D6 — a cross-database index cannot be maintained by a foreign key, and the
sweeper is driven from the side that lost the rows.** `persona_memories` lives in
`personas.db`; `persona_memory_embedding` lives in `personas_data.db`. `ON DELETE
CASCADE` cannot cross the file boundary, so the 2026-08-17 purge took 6,535
memory rows and left 5,158 vectors. The GC that exists,
`gc_archived_memory_embeddings` (`repos/core/memories.rs:1925-1968`), starts with
`SELECT id FROM persona_memories WHERE tier = 'archive' LIMIT ?1` — **an inventory
taken from the table the rows were deleted from**, so a deleted row contributes
nothing to sweep. `delete_memory_embeddings` is called on the explicit
`batch_delete` path only. This is the doctrine's *"only an inventory of what
should exist finds it"* with the inventory pointed at the wrong side: the
recoverable inventory is the vector table, diffed against the memory table, not
the reverse.

**D7 — `dropped_far` is logged at `debug` and never surfaced on the memory
path.** `memory_recall.rs:374-379` logs `hits`, `kept`, `dropped_far` at
`tracing::debug!`. `filter_by_model`'s exclusion count *is* surfaced — it has a
process counter (`MEMORY_MODEL_GUARD_EXCLUDED`, `repos/core/memories.rs:1786`)
and a `tracing::warn!` — so the repo knows how to do this and did it for one of
the two filters.

**D8 — the vector KB's preview is a manual search, not an answer's grounding.**
`SearchTab.tsx` is the only surface where a user sees retrieved chunks with
scores, and nothing in the product routes an *answer* through it. So the
best-instrumented retrieval surface in the app (floor disclosure, normalized +
raw score, partial-extraction badge, expandable chunk, copy button) is the one
that never grounds anything, and the two that do ground things (companion,
persona runs) have a chip strip and nothing respectively.

**D9 — `PREVIEW_TITLE_MAX` truncation is correct here and wrong 40 lines away in
a sibling module, and the difference is `chars()` vs `len()`.**
`prompt.rs:74-83` uses `s.chars().count() <= PREVIEW_TITLE_MAX` and
`chars().take(MAX - 1)`, so a title is never marked as cut when it wasn't.
`src/engine/runner/mod.rs:2473` uses `content_preview.len() > 500` with
`chars().take(500)` and mismarks 23 of 16,309 stored previews — see
[`tool-result-contract`](./tool-result-contract.md) §0. Recorded here because the
correct form is in *this* leaf's exemplar and should be cited when the other is
fixed.

---

## 9. The gate — DECLINED, and the reason is that the condition is extinct

The natural signal is *"a filter that reports how many items it removed, whose
count the caller discards"* — the shape behind D4, D6 and D7.

**Measured, `src-tauri/**/*.rs`, `#[cfg(test)]` stripped:**

| form | files | sites |
|---|---:|---:|
| **violating** — `let (kept, _) = …filter_by_*/partition/prune/dedupe/split_*(…)` | **0** | **0** |
| **compliant** — the second half bound to a real name | **17** | **24** |

**24 of 24 destructuring sites in the tree bind the removed-count to a name**
(`core/src/retrieval/mod.rs:202`, `db/src/memory_recall.rs:374`,
`repos/core/memories.rs:1455,1826`, `vector_kb.rs:993`,
`companion/brain/retrieval.rs:178,606`, `companion/brain/embeddings.rs:90`,
`context_generation.rs:1534,1704,2073,2092`, `crypto.rs:117,1162`, `cron.rs:160`,
`dev_tools.rs:3831`, `reviews.rs:1014`, `twin.rs:851`, `fix_pass.rs:309`,
`db_query.rs:2968`, `healthcheck.rs:1223`, `kb_scan.rs:109`). **There is nothing
to ratchet.**

And the census cannot express this outcome. A rule matching zero files **fails
the runner structurally** — by design, because "found nothing" and "looked at
nothing" must not be the same result. So publishing this as a rule with
`baseline: {files: 0}` is not merely useless; it would break every future census
run. The doctrine states the limit directly: *"the census cannot express 'must be
zero' by construction… if a condition should reach zero, say so, and say the rule
must be deleted at that point rather than baselined at 0."* This one starts at
zero.

**The real defect is one the census cannot see at all, for a second and
independent reason: it is an absence *inside* a function.** D4's four silent
`continue` arms are not a syntax you can match — a `continue` with no counter
beside it is the most ordinary line in Rust, and every attempt to key on
"`continue` inside a loop that also computes a score" would flood. What
distinguishes a disclosed drop from a silent one is whether a number reaches the
response type, which is a **question about the type, not about the body**.

**So: prefer the type, and the type is cheap and already half-built.** Make the
retrieval response carry its attrition, not its survivors only:

```rust
pub struct KbSearchResponse {
    pub results: Vec<VectorSearchResult>,
    pub floor_filtered: usize,   // exists today
    pub unhydrated: usize,       // index/store disagreement — the orphan arm
    pub below_min_score: usize,
    pub filtered_out: usize,
    pub capped_at_top_k: usize,
}
```

Every field is a `usize` the loop already has in scope, and a reviewer adding a
fifth `continue` to `select_search_results` without a field to increment is
adding a struct field, which is visible in a diff, in a ts-rs binding, and in the
UI that must render it. That is the whole gate. The same edit applies on the
memory path: `PackedRecall` already carries `omitted`
(`memory_recall.rs:319-322`) — it needs `dropped_far` and `unhydrated` beside it,
and the runner needs to persist `all_ids` (D3) rather than discard it.

**Also declined: a gate on the missing persona-run preview.** *"An execution row
with no grounding record"* is a schema absence — `persona_executions` has no
column — and per the doctrine a diff-shaped or count-shaped gate cannot see a
thing that was never declared. The instrument for that is an inventory of
model-facing prompts compared against the set of prompts with a persisted
grounding record: 2 assemblers, 1 record. Written here; not built, because
building it means adding a column and a write to the live execution path.

### Deferred fixes registered

None new. D6's fix (an orphan sweep over `persona_memory_embedding` diffed
against `persona_memories`) **deletes rows on its first run** and is squarely on
the "note, don't apply" side of the standing rules — and on this install its
first run would delete all 5,158, which the operator may or may not want. D1's
fix moves a write from the renderer to the backend and changes what a live
surface stores.

---

## 12. Corrections

**12.1 — `sides: "client"` is CONTRADICTED, and this is the eighth.** The
preview's correctness is decided entirely on the server: whether it is a
projection (`prompt.rs:102`) or a second query, whether membership comes from
scoped SQL or from the index (`memory_recall.rs:341-345`), and whether the
attrition counts reach the wire (`vector_kb.rs:993` vs the four uncounted
`continue`s at `:1158-1210`). Every deviation D2–D7 is server-side. The client
half is real and is one 180-line component that renders whatever it is handed —
so unlike the doctrine's seventh contradiction there *is* a client half, it is
just not where anything can go wrong. **`client` is incomplete, not inverted**;
the correction is `both`, with the note that the two halves are not equally
weighted. Ledger: `client` now **8 contradicted, 2 upheld**.

**12.2 — `convergence: "converged"` FAILS, in the mode the doctrine calls a
fleet-wide silence — with a twist: the silence is not fleet-wide, it is
cohort-wide, and the cohort is two.** Measured at composition rather than
assumed: `ascent` has **no embeddings, no vector store and no retrieval at all**
(its `similarity` hits are code-analysis, and its `ModelScorecard` is a model
leaderboard); `personas-cloud` has no retrieval layer; `personas-web`'s
`ResearchSources.tsx` is a **static marketing illustration** with hardcoded
literals (`annotations: 6`, `citations: 84`, invented author names) and a search
bar that is a `<span>`. **Effective cohort for this leaf: 2** — `brainiac` and
`vibeman`.

Of those two, `vibeman` is **silent**: `insightSimilarity.ts:65` computes cosine
and uses it at `:100` as a boolean dedup threshold; no score is ever rendered and
there is no grounding UI. `brainiac` answers it, differently and instructively:
its MCP `memory_search` payload (`mcp.rs:1036-1092`) returns per-hit `id`,
`content`, validity window, `via_graph`, `provenance_id` and `entity_anchors` —
and **grep for `"score"` in that file returns 0 matches**, a deliberate choice to
withhold the number from the agent while its REST surface exposes it raw
(`http.rs:328,428`). It has one ranking entry point for both surfaces
(`mcp.rs:959-963`, *"ONE ranking entry point for both surfaces… Before this, MCP
called the reranker-less `search` wrapper"*) — **the same clause as §2(a),
reinvented by a different mechanism, and reached the hard way, by having had the
bug.** That is the strongest oracle result on this leaf and it is worth more than
the agreement count.

**On two clauses `brainiac` is ahead of Personas and on two Personas is ahead of
`brainiac`.** It withholds contested items with a `contested_withheld` count and
a note (`mcp.rs:1097-1104`) and flags non-canonical hits `governance: "candidate"`
— disclosure at a granularity we have nowhere. We render the normalized score
*and* the raw distance where its MCP surface renders neither, and our preview is
a projection of the prompt value where its is a projection of a search response.
**So: not converged, not a silence, and not a Personas victory lap — a 2-repo
cohort with two different partial answers whose union is §2.** Ledger: 16 tested,
16 failed.

**12.3 — the brief's central hypothesis is refuted on the path it named, and the
refutation is the most valuable thing in this document.** The brief asked whether
"the previewed chunks are the same ones actually sent to the model (a preview
computed by a second, similar-but-different query is the defect)". On the
companion path they are the same **by construction**: `summarize_recall` cannot
issue a query because it takes `&Recall` and touches no pool. The defect the
brief predicted does not exist here, and looking for it is how the real defects
(persistence, attrition counting, the missing persona-run preview) surfaced
instead.

**12.4 — the brief's dangling-vector lead is real, is measurable live, and its
severity is the opposite of what it implies.** *"A retrieval preview over
dangling entities is a live, measurable case"* — confirmed: **5,158 of 5,158
vectors are orphans right now** (live `personas_data.db` vs live `personas.db`,
read-only, 2026-08-17). But a preview over them is impossible, because the KNN
result is a *relevance map* intersected with a scoped candidate set, so an
orphan has no row to lift and can never appear in a preview or a prompt. The
brief's implied risk (orphans leak into a grounding display) is architecturally
foreclosed. The **actual** cost is a full KNN per recall over a table that is
100% garbage, and a `hits=…` debug counter that now overstates the grounding by
its entire value. **A defect is not resolved by deleting the rows that exhibited
it — and neither is a defect created by deleting them; here the deletion revealed
that the design was right and the telemetry was not.**

**12.5 — a denominator I nearly published wrong.** The first sidecar figure was
"83 of 1,779 turns — 4.7%", which reads as catastrophic. The sidecar table's
earliest row is 2026-08-05 and the turn table's earliest is 2026-06-12: the
feature did not exist for 92% of that history. Date-aligned, the real numbers are
**83 of 129 in-window (64.3%), 80 with a recall payload (62.0%), and 0 of 12
after 2026-08-09** — a materially different and much more actionable finding,
because the second half is a *regression*, not a rollout gap. The doctrine's
`GROUP BY`-scope rule generalises to time: **check that your denominator covers
the same interval as your numerator**, and it too would have agreed with my
thesis if I had not.

**12.6 — I could not measure the thing the leaf is nominally about.** "Which
memories the answer actually used" is unanswerable for **2,188 of 2,188
executions**, because the record does not exist (D2). Every statement in this
document about the persona path is derived from reading the assembler, not from
observing an artifact. That is a weaker class of evidence than the rest of this
document and it is labelled as such.

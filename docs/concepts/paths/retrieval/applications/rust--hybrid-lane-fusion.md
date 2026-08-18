---
layer: application
subject: retrieval
technique: hybrid-lane-fusion
stack: rust
---

# Hybrid lane fusion in the companion brain and the KB search path

The repo runs the technique twice, with two different fusion strategies
chosen for two different consumers — and both consume the same shared pure
primitives in `src-tauri/core/src/retrieval/mod.rs` (distance floor, model
filter, lane ranking, one FTS5 sanitization door).

## The companion recall bundle (`src-tauri/src/companion/brain/retrieval.rs`)

The module doc (`retrieval.rs:1-24`) is a compressed history of the standard
being learned the hard way. Three lanes feed each turn's recall:

- **Keyword (BM25 over an FTS index)** — runs in *every* build because it
  needs no embedder. The doc records what life was like without a
  query-dependent lane: the shipped build "returned the same N most-recent
  episodes and the same top-N facts on every single turn, with `doctrine`
  hard-coded empty" (`retrieval.rs:6-9`).
- **Vector (KNN)** — `ml`-gated, *layered on top of* the keyword lane, not
  replacing it. The union discipline is explicit at `retrieval.rs:212-216`:
  "Running both and unioning means the ml build is a strict superset of the
  non-ml build rather than an alternative to it" — the golden path's
  lane-addition rule, stated as a code comment. `union_keyword_ids`
  (`retrieval.rs:408-424`) appends keyword hits into the vector selection in
  rank order, deduped, capped, honoring exclusion sets.
- **Always-include tiers** (`retrieval.rs:77-89`) — top facts, active goals,
  top procedurals, open backlog. "Query-independent by design"; every cap is
  small and each constant carries a sentence of why.

**Budget, not quota** — the header section at `retrieval.rs:15-24` is titled
exactly that. Both paths target `RECALL_EPISODE_TARGET = 20` total episodes
(`:65`); the recency tail is sized from what the other lanes *actually
returned* (`with_recency_tail`, `:433-454`; the non-ml arm at `:357-359`),
after a real incident: the ml path once hard-coded a 5-turn tail assuming the
vector lane would add ~12, the vector lane contributed zero on an unembedded
corpus, and the "richer" build delivered *fewer* memories than the plain one.
`RECENCY_FLOOR = 6` (`:66-70`) is the standard's tier minimum: the last turns
of the live conversation always ride along, because losing the immediately
preceding turn to a well-matched older one would be the worse failure.

**Overfetch-then-split** — `VECTOR_OVERFETCH = 80` (`:55-60`): one KNN pull,
split by kind in app code via `rank_into_lanes` (`core/src/retrieval/mod.rs:146-165`),
"generous so kind-imbalanced corpora don't starve one tier". Doctrine gets a
dedicated kind-scoped scan (`retrieval.rs:198-210`) precisely because the
shared top-K starved it — a small, structurally distinct corpus losing every
seat to an episode-heavy one.

**Blind predicates re-imposed** — the vector lane filters on kind only, so
`load_episodes_by_ids` re-imposes the session filter in SQL
(`retrieval.rs:259-267`, `WHERE ... session_id = ?` at `:516-519`); the
comment names the leak it prevents: an episode from a *different*
conversation riding a similarity hit into this session's working memory.

**Fusion telemetry** — the `recall_distance` debug log (`retrieval.rs:247-256`)
emits per-lane counts, `dropped_far`, and the nearest distance: lane
provenance carrying its predicate.

## The KB search path (`src-tauri/src/commands/credentials/vector_kb.rs`)

`kb_search` (`vector_kb.rs:916-1136`) fuses differently — **reciprocal rank
fusion** (`rrf_rerank`, `:889-912`, the standard constant 60.0 with its
rationale inline) — because here the lanes are vector-canonical with BM25 as
a nudger, not co-equal. The ordering of stages is the transferable craft:

1. Overfetch ×3 from the vector index (`RERANK_OVERFETCH`, `:860-862`,
   clamped at `:979-981`).
2. **Floor before fusion** (`:984-995`): the shared
   `filter_by_distance_floor` runs on the vector pool *before* RRF "so BM25
   can't resurrect a semantically-unrelated chunk", and before truncation
   "so the caller learns how much noise was cut" — `floor_filtered` is
   returned in the response (`:998-1001`, `:1132-1135`).
3. BM25 ranks within the candidate pool only; every failure on the FTS side
   degrades to vector-only ordering with a warning, never a blocked search
   (`:1004-1061`).
4. **Filter-then-cut** (`:1063-1073` and `select_search_results`,
   `:1149-1212`): when a source filter selects a subset, the `top_k` cut
   happens *after* filtering, otherwise the caller gets "however many of the
   global top_k happen to live under that path" — usually a handful, often
   zero.

## Where it stops short of the standard (kept as standard; noted)

- **The sanitization door has three forks.** The unified
  `build_fts5_match_query` (`core/src/retrieval/mod.rs:247-270`, with
  stopwords, min-length, term cap, dedupe) coexists with the KB's own
  `build_fts5_query` (`vector_kb.rs:872-879` — whitespace split only, no
  stopword/length/count bounds) and a third in the execution search repo.
  The core module's own doc admits it: "Two private forks of this shape
  already existed... consolidating them is a separate, behavior-visible
  change."
- **No cross-lane convergence signal in the companion path.** `union_keyword_ids`
  dedupes an item surfaced by both lanes but discards the fact that two
  lanes agreed; RRF on the KB path gets this for free, the union on the
  companion path does not.
- **No fused-order eval.** Neither fusion strategy is measured against a
  labeled set or its own single-lane ablations (see the
  retrieval-evaluation deviation in the forge report).

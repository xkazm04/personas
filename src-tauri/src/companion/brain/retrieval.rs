//! Hybrid retrieval bundling memory into the working context for each turn.
//!
//! Pipeline (Phase 2):
//!   1. Graph traversal from entities mentioned in current/recent turns (1–2 hops, cap 15)
//!   2. Vector cosine search over `companion_embedding` (top 10)
//!   3. BM25 over `companion_fts` (top 5)
//!   4. Recency boost: episodes within last 24h auto-included
//!   5. Deduplicate by node_id, score-merge, take top 25
//!   6. Format with `[fact #id — derived from ep_X, ep_Y]` provenance footers
//!
//! Phase 0: stub.
